#!/usr/bin/env bash
#
# ReCuDe Match 初期デプロイスクリプト（GCP/Firebaseへの確認用デプロイ）
#
# 事前に手動で済ませておく必要があること（README.md「GCPへの確認用デプロイ」参照）:
#   1. Firebase Consoleでプロジェクトを作成する
#   2. `firebase login` でCLIにログインする
#   3. `firebase use --add` を実行し、エイリアス名を "default" にしてプロジェクトを紐づける
#   4. Firebase Console > Authentication > Sign-in method で「電話番号」プロバイダを有効化する
#
# このスクリプトは以下を自動で行う:
#   - Web App登録の確認・作成、SDK設定値の environment.ts への反映
#   - Firestoreデータベースの作成（未作成の場合）
#   - Twilioシークレットのプレースホルダー登録（実SMSを送らないため）
#   - APP_BASE_URL の設定
#   - 依存関係インストール・ビルド・firebase deploy 一式
#
# 実SMSを送りたい場合は、事前に `firebase functions:secrets:set TWILIO_ACCOUNT_SID` 等で
# 実際の値を設定しておけば、このスクリプトはその値を上書きしない。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=== ReCuDe Match 初期デプロイ ==="

if ! command -v firebase >/dev/null 2>&1; then
  echo "エラー: firebase CLI が見つかりません。'npm install -g firebase-tools' 等でインストールしてください。" >&2
  exit 1
fi

if ! firebase login:list --json 2>/dev/null | node -e "
  const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  process.exit((data.result || []).length > 0 ? 0 : 1);
"; then
  echo "エラー: firebase CLI にログインしていません。先に 'firebase login' を実行してください。" >&2
  exit 1
fi

PROJECT_ID="${PROJECT_ID:-}"
if [ -z "$PROJECT_ID" ] && [ -f .firebaserc ]; then
  PROJECT_ID="$(node -p "(() => { try { return JSON.parse(require('fs').readFileSync('.firebaserc', 'utf8')).projects.default || ''; } catch { return ''; } })()")"
fi

if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "recude-match-dev" ]; then
  echo "エラー: デプロイ先のFirebaseプロジェクトが設定されていません。" >&2
  echo "  'firebase use --add' を実行し、エイリアス名を \"default\" にして紐づけてください。" >&2
  echo "  （もしくは PROJECT_ID 環境変数で直接指定してください）" >&2
  exit 1
fi

echo "デプロイ先プロジェクト: $PROJECT_ID"
if [ "${YES:-}" != "1" ] && [ "${1:-}" != "--yes" ]; then
  read -r -p "このプロジェクトに初期デプロイを実行します。続行しますか？ [y/N] " CONFIRM
  case "$CONFIRM" in
    [yY]|[yY][eE][sS]) ;;
    *) echo "中断しました。"; exit 1 ;;
  esac
fi

TENANT_ID="${TENANT_ID:-}"
if [ -z "$TENANT_ID" ]; then
  read -r -p "テナントID（例: gifu-tokyo）を入力してください（seed:prod で指定する SEED_TENANT_ID と同じ値）: " TENANT_ID
fi
if [ -z "$TENANT_ID" ]; then
  echo "エラー: テナントIDが指定されていません。" >&2
  exit 1
fi
echo "テナントID: $TENANT_ID"

echo ""
echo "--- 必要なGCP APIの有効化 ---"
REQUIRED_APIS="firestore.googleapis.com secretmanager.googleapis.com cloudfunctions.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com run.googleapis.com iam.googleapis.com cloudresourcemanager.googleapis.com"
if command -v gcloud >/dev/null 2>&1; then
  # shellcheck disable=SC2086
  gcloud services enable $REQUIRED_APIS --project "$PROJECT_ID"
  echo "  必要なAPIを有効化しました。直後は反映まで数分かかる場合があります（後続のステップが失敗したら少し待って scripts/deploy-init.sh を再実行してください）。"
else
  echo "警告: gcloud CLIが見つからないため、以下のAPIを手動で有効化してください。" >&2
  for API in $REQUIRED_APIS; do
    echo "  https://console.developers.google.com/apis/api/$API/overview?project=$PROJECT_ID" >&2
  done
  read -r -p "有効化が完了したら Enter を押して続行してください..." _
fi

echo ""
echo "--- Web App登録の確認 ---"
APPS_JSON="$(firebase apps:list WEB --project "$PROJECT_ID" --json)"
APP_ID="$(node -e "
  const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  const apps = data.result || [];
  const app = apps.find((a) => a.displayName === 'ReCuDe Match') || apps[0];
  console.log(app ? app.appId : '');
" <<<"$APPS_JSON")"

if [ -z "$APP_ID" ]; then
  echo "Web Appが未登録のため新規作成します..."
  CREATE_JSON="$(firebase apps:create WEB "ReCuDe Match" --project "$PROJECT_ID" --json)"
  APP_ID="$(node -e "console.log(JSON.parse(require('fs').readFileSync(0, 'utf8')).result.appId)" <<<"$CREATE_JSON")"
  echo "  作成しました: $APP_ID"
else
  echo "  既存のWeb Appを使用します: $APP_ID"
fi

echo ""
echo "--- environment.ts への設定値反映 ---"
CONFIG_TEXT="$(firebase apps:sdkconfig WEB "$APP_ID" --project "$PROJECT_ID")"
extract_field() {
  echo "$CONFIG_TEXT" | grep -oE "\"?$1\"?: *\"[^\"]*\"" | head -1 | sed -E 's/.*"([^"]*)"$/\1/'
}
API_KEY="$(extract_field apiKey)"
AUTH_DOMAIN="$(extract_field authDomain)"
CONFIG_PROJECT_ID="$(extract_field projectId)"
STORAGE_BUCKET="$(extract_field storageBucket)"
MESSAGING_SENDER_ID="$(extract_field messagingSenderId)"
CONFIG_APP_ID="$(extract_field appId)"

node "$SCRIPT_DIR/write-env-config.mjs" \
  "$API_KEY" "$AUTH_DOMAIN" "$CONFIG_PROJECT_ID" "$STORAGE_BUCKET" "$MESSAGING_SENDER_ID" "$CONFIG_APP_ID" "$TENANT_ID"

echo ""
echo "--- Firestoreデータベースの確認 ---"
FIRESTORE_CREATED=0
for ATTEMPT in 1 2 3; do
  if firebase firestore:databases:create "(default)" \
      --location="${FIRESTORE_LOCATION:-asia-northeast1}" \
      --project "$PROJECT_ID" 2>&1 | tee /tmp/recude-firestore-create.log; then
    echo "  Firestoreデータベースを作成しました。"
    FIRESTORE_CREATED=1
    break
  fi
  if grep -qi "already exists" /tmp/recude-firestore-create.log 2>/dev/null; then
    echo "  Firestoreデータベースは既に存在します（スキップ）。"
    FIRESTORE_CREATED=1
    break
  fi
  if [ "$ATTEMPT" -lt 3 ]; then
    echo "  失敗しました。APIの有効化が反映されるまで少し待って再試行します(${ATTEMPT}/3)..."
    sleep 20
  fi
done
if [ "$FIRESTORE_CREATED" -ne 1 ]; then
  echo "警告: Firestoreデータベースの作成に失敗しました。Firebase Consoleで手動作成が必要な場合があります。" >&2
fi

echo ""
echo "--- Twilioシークレットのプレースホルダー登録 ---"
echo "  (実SMSは送信されません。 functions/src/twilio.ts のフォールバックによりログ出力のみになります)"
for SECRET in TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_FROM_NUMBER; do
  if firebase functions:secrets:access "$SECRET" --project "$PROJECT_ID" >/dev/null 2>&1; then
    echo "  $SECRET: 設定済みのためスキップします。"
  else
    if printf 'unset' | firebase functions:secrets:set "$SECRET" --project "$PROJECT_ID" --force --data-file -; then
      echo "  $SECRET: プレースホルダー 'unset' を設定しました。"
    else
      echo "エラー: $SECRET の設定に失敗しました（上のログを参照）。Secret Manager APIが有効化されているか確認してください。" >&2
      exit 1
    fi
  fi
done

echo ""
echo "--- APP_BASE_URL / WEBAUTHN_RP_NAME の設定 ---"
ENV_FILE="functions/.env.$PROJECT_ID"
if [ ! -f "$ENV_FILE" ]; then
  {
    echo "APP_BASE_URL=https://$PROJECT_ID.web.app"
    echo "WEBAUTHN_RP_NAME=\"ReCuDe Match\""
  } > "$ENV_FILE"
  echo "  $ENV_FILE を作成しました。"
else
  echo "  $ENV_FILE は既に存在するためスキップします。"
fi

echo ""
echo "--- 依存関係インストール ---"
npm install
npm --prefix functions install

echo ""
echo "--- ビルド ---"
npm --prefix functions run build
npm run build

echo ""
echo "--- デプロイ ---"
firebase deploy --project "$PROJECT_ID"

HOSTING_URL="https://$PROJECT_ID.web.app"
echo ""
echo "=== 初期デプロイ完了 ==="
echo "アプリURL: $HOSTING_URL"
echo ""
echo "残っている手動セットアップ（未実施の場合）:"
echo "  1. Firebase Console > Authentication > Sign-in method > 電話番号 を有効化"
echo "  2. 同画面下部の「テスト用の電話番号」に、確認用の電話番号と固定OTPコードを登録"
echo "     （実SMSを送らずにログイン確認できるようになります）"
echo "  3. サービスアカウントキーを Firebase Console > プロジェクトの設定 > サービスアカウント からダウンロード"
echo "  4. テナントのセットアップ（テナントと最初の管理者の作成）:"
echo "     GOOGLE_APPLICATION_CREDENTIALS=<キーのパス> GCLOUD_PROJECT=$PROJECT_ID \\"
echo "       SEED_TENANT_ID=... SEED_TENANT_NAME=... SEED_SERVICE_NAME=... \\"
echo "       SEED_ADMIN_PHONE=... SEED_ADMIN_NAME=... \\"
echo "       npm --prefix functions run seed:prod -- --yes"
echo ""
echo "詳細はREADME.mdの「GCPへの確認用デプロイ」を参照してください。"
