#!/usr/bin/env bash
#
# ReCuDe Match 差分デプロイスクリプト（初期デプロイ済みのプロジェクトへの日常的な更新用）。
# Web App登録・Firestore作成・Twilioプレースホルダー・APP_BASE_URLの設定は行わない
# （初回のみ scripts/deploy-init.sh で実施済みという前提）。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=== ReCuDe Match 差分デプロイ ==="

if ! command -v firebase >/dev/null 2>&1; then
  echo "エラー: firebase CLI が見つかりません。" >&2
  exit 1
fi

PROJECT_ID="${PROJECT_ID:-}"
if [ -z "$PROJECT_ID" ] && [ -f .firebaserc ]; then
  PROJECT_ID="$(node -p "(() => { try { return JSON.parse(require('fs').readFileSync('.firebaserc', 'utf8')).projects.default || ''; } catch { return ''; } })()")"
fi

if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "recude-match-dev" ]; then
  echo "エラー: デプロイ先のFirebaseプロジェクトが設定されていません。先に scripts/deploy-init.sh を実行してください。" >&2
  exit 1
fi

echo "デプロイ先プロジェクト: $PROJECT_ID"

echo ""
echo "--- スタンプの取り込み確認 ---"
# stamps/ の変更を npm run stamps:sync で取り込み忘れていたら、ここで止める(docs/stamps.md)。
npm run stamps:check

echo ""
echo "--- ビルド ---"
npm --prefix functions run build
npm run build

echo ""
echo "--- デプロイ ---"
firebase deploy --project "$PROJECT_ID"

echo ""
echo "=== 差分デプロイ完了 ==="
echo "アプリURL: https://$PROJECT_ID.web.app"
