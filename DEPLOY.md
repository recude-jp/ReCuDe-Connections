# ReCuDe Connections デプロイ手順

新しいリポジトリから取得したソースを Firebase（GCP）にデプロイするための手順。

- **A. 既存プロジェクトへのデプロイ**: デプロイ済みの Firebase プロジェクト（`.firebaserc` の `default` = `default-41833`）に、新しいリポジトリからデプロイする。通常はこちら。
- **B. 新しいプロジェクトへの初期デプロイ**: 別の Firebase プロジェクトを一から立ち上げる。

各スクリプトの詳しい動きは [`DEVELOPMENT.md`](DEVELOPMENT.md) の「GCPへの確認用デプロイ」も参照。

> **名称について**: プロジェクト名は ReCuDe Connections に変わったが、パッケージ名・Angular プロジェクト名・ビルド出力先（`dist/recude-match/browser`）などの技術的な識別子は旧名 `recude-match` のまま。以下の手順もそのまま使う。

---

## 0. 前提

| ツール | 用途 | 確認コマンド |
| --- | --- | --- |
| Node.js（20 以上。Cloud Functions の実行環境は Node 20） | ビルド | `node -v` |
| npm | 依存関係 | `npm -v` |
| Firebase CLI | デプロイ | `firebase --version`（無ければ `npm install -g firebase-tools`） |
| gcloud CLI（B のみ・推奨） | GCP API の有効化 | `gcloud --version` |

デプロイするアカウントには、対象プロジェクトの**オーナー**か**編集者**のロールが必要。

---

## 1. リポジトリを取得する

```bash
git clone <新しいリポジトリのURL> ReCuDe-Connections
cd ReCuDe-Connections
npm install
npm --prefix functions install
```

`npm run deploy`（`scripts/deploy.sh`）は依存関係をインストールしない。クローンした直後は、上の 2 行を必ず実行しておく。

### リポジトリに含まれているべきファイル

デプロイには、以下のファイルがリポジトリにコミットされている必要がある。クローン後、存在することを確認する。

| ファイル | 内容 |
| --- | --- |
| `.firebaserc` | デプロイ先プロジェクト（`default`）の紐づけ |
| `firebase.json` | Hosting・Functions・Firestore・Storage の設定 |
| `src/environments/environment.ts` | 本番の Firebase SDK 設定値と `tenantId` |
| `functions/.env` | Functions の共通パラメータ（`WEBAUTHN_RP_NAME` など） |
| `functions/.env.<プロジェクトID>` | プロジェクト固有のパラメータ（`APP_BASE_URL`） |
| `firestore.rules` / `firestore.indexes.json` / `storage.rules` | セキュリティルールとインデックス |

逆に、**サービスアカウントキー（JSON）は絶対にコミットしない**。Twilio の認証情報は Secret Manager にあるので、リポジトリには含まれない。

---

## A. 既存プロジェクトへのデプロイ（通常）

### A-1. ログインとプロジェクトの確認

```bash
firebase login
firebase use          # 「Active Project: default (default-41833)」と表示されることを確認
```

別のアカウントでログインしている場合は、`firebase login:use <メールアドレス>` で切り替えるか、`firebase logout` してからログインし直す。

### A-2. デプロイ

```bash
npm run deploy
```

[`scripts/deploy.sh`](scripts/deploy.sh) が次の順に実行する。

1. `npm run stamps:check`（`stamps/` の取り込み漏れがあれば、ここで止まる。→ [`docs/stamps.md`](docs/stamps.md)）
2. Cloud Functions のビルド（`npm --prefix functions run build`）
3. Angular のビルド（`npm run build` → `dist/recude-match/browser`）
4. `firebase deploy`（Hosting・Functions・Firestore のルールとインデックス・Storage のルール）

別のプロジェクトにデプロイするときは、`PROJECT_ID=<プロジェクトID> npm run deploy` で上書きできる。

### A-3. デプロイ中に聞かれること

- **関数を削除するかどうか**: コードから消えた関数が本番に残っていると、「削除しますか」と聞かれる（例: `decideInvite`・`getInviteStatus`・`submitCandidateProfile`）。`y` で削除する。
- **API の有効化・権限の反映待ち**: トリガー型や定期実行型の関数（`onRoomMessageCreated`・`recomputeDerivedProfiles`）を初めてデプロイすると、Eventarc・Pub/Sub・Cloud Scheduler が自動で有効になる。権限の反映待ちで失敗したら、数分待ってから `npm run deploy` をもう一度実行する。

### A-4. 一度だけ実行するデータ移行（未実施の場合のみ）

以下の移行スクリプトは、何度実行しても同じ結果になる。そのプロジェクトでまだ実行していなければ、デプロイの後に一度だけ実行する。どれもサービスアカウントキーが必要（Firebase Console > プロジェクトの設定 > サービスアカウント からダウンロードする）。

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
export GCLOUD_PROJECT=default-41833

npm --prefix functions run migrate:profile -- --yes           # テナントごとのプロフィール項目への移行
npm --prefix functions run migrate:community-admins -- --yes  # 連携コミュニティの管理者の反映
npm --prefix functions run migrate:rooms -- --yes             # 1対1チャットのルーム方式への移行
```

各スクリプトの内容は [`DEVELOPMENT.md`](DEVELOPMENT.md) の同名の節を参照。

### A-5. 動作確認

→ [デプロイ後の確認](#デプロイ後の確認)

---

## B. 新しいプロジェクトへの初期デプロイ

### B-1. 事前準備（手動・一度だけ）

1. [Firebase Console](https://console.firebase.google.com/) でプロジェクトを新規作成する。
2. `firebase login` で CLI にログインする。
3. プロジェクトルートで `firebase use --add` を実行し、作成したプロジェクトを**エイリアス名 `default`** で紐づける（`.firebaserc` が書き換わる）。
4. Firebase Console > Authentication > Sign-in method で「電話番号」プロバイダを有効化する。
5. 同じ画面の「テスト用の電話番号」に、確認用の電話番号と固定 OTP コード（例: `090-0000-0001` / `123456`）を登録する。
6. Firebase Console > プロジェクトの設定 > サービスアカウント から秘密鍵（JSON）をダウンロードする。この鍵はリポジトリの外に置く。

### B-2. 初期デプロイ

```bash
npm run deploy:init
```

途中でテナントIDを聞かれる（例: `tokyo-gifu-connect`）。B-3 の `SEED_TENANT_ID` にも同じ値を指定する。
`TENANT_ID=<テナントID> npm run deploy:init -- --yes` とすれば、質問をすべて省略できる。

[`scripts/deploy-init.sh`](scripts/deploy-init.sh) が次のことを自動で行う。

- 必要な GCP API の有効化（gcloud CLI が無い場合は、有効化する URL を表示する）
- Web App の登録と、`src/environments/environment.ts` への SDK 設定値と `tenantId` の書き込み
- Firestore データベースの作成（`asia-northeast1`。`FIRESTORE_LOCATION` で変更できる）
- Twilio のシークレットに、プレースホルダー `unset` を登録する（実際の SMS は送らず、ログに出すだけになる）
- `functions/.env.<プロジェクトID>` の作成（`APP_BASE_URL=https://<プロジェクトID>.web.app`）
- 依存関係のインストール、ビルド、`firebase deploy`

API の有効化が反映される前に失敗した場合は、数分待ってから再実行する（処理済みのステップはスキップされる）。

### B-3. テナントと最初の管理者の作成（一度だけ）

```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
GCLOUD_PROJECT=<プロジェクトID> \
SEED_TENANT_ID=<B-2 で入力したテナントID> \
SEED_TENANT_NAME="東京岐阜県人会" \
SEED_SERVICE_NAME="TOKYO GIFU CONNECT" \
SEED_ADMIN_PHONE=+819000000001 \
SEED_ADMIN_NAME="山田太郎" \
npm --prefix functions run seed:prod -- --yes
```

- `SEED_TENANT_ID` が `environment.ts` の `tenantId` と違うと、ログイン画面がテナントを見つけられない。
- `SEED_ADMIN_PHONE` には、B-1 で登録したテスト用の電話番号を国際形式（`+81...`）で指定する。

### B-4. 生成されたファイルをコミットする

初期デプロイで書き換わったファイルをコミットしておく。コミットしないと、次にクローンした人がデプロイできない。

```bash
git add .firebaserc src/environments/environment.ts functions/.env.<プロジェクトID>
git commit -m "Configure Firebase project <プロジェクトID>"
```

以後の更新は **A-2** と同じく `npm run deploy` で行う。

---

## デプロイ後の確認

1. `https://<プロジェクトID>.web.app` を開く（既存プロジェクトなら https://default-41833.web.app ）。
2. `/login` で、テスト用の電話番号と固定 OTP コードを入力してログインできることを確認する。
3. 管理者の番号でログインし、メニューに「管理」が出ること、`/admin` に入れることを確認する。
4. 招待を送り、Cloud Functions のログに招待リンクが出ることを確認する（Twilio が未設定の間は、実際の SMS は送られない）。
   ```bash
   firebase functions:log --project <プロジェクトID>
   ```
5. 古い画面のままの場合は、再読み込みする。PWA の Service Worker（`ngsw`）が古い版をキャッシュしていることがある。

---

## 部分的なデプロイ

`npm run deploy` はすべてをデプロイする。一部だけ反映したいときは、ビルドしてから `--only` を付けて実行する。

```bash
# Hosting（画面）だけ
npm run build && firebase deploy --only hosting

# Cloud Functions だけ（特定の関数だけなら functions:<関数名>）
npm --prefix functions run build && firebase deploy --only functions

# セキュリティルール・インデックスだけ
firebase deploy --only firestore:rules,firestore:indexes,storage
```

## ロールバック

- **Hosting**: Firebase Console > Hosting > リリース履歴 から、以前のリリースを「ロールバック」する。
- **Functions・ルール**: 以前のコミットをチェックアウトしてから、`npm run deploy` で再デプロイする。
- **スタンプ**: [`docs/stamps.md`](docs/stamps.md) のロールバック手順を参照。

## 実際の SMS 送信に切り替える

```bash
firebase functions:secrets:set TWILIO_ACCOUNT_SID --project <プロジェクトID>
firebase functions:secrets:set TWILIO_AUTH_TOKEN --project <プロジェクトID>
firebase functions:secrets:set TWILIO_FROM_NUMBER --project <プロジェクトID>
npm run deploy
```

実際の値を設定した後は、`deploy-init.sh` も `deploy.sh` もその値を上書きしない。

## 独自ドメインを使う場合

招待 SMS の URL とパスキー（WebAuthn）の検証は、どちらも `APP_BASE_URL` をもとにしている。Firebase Console > Hosting で独自ドメインを追加したら、`functions/.env.<プロジェクトID>` の `APP_BASE_URL` をそのドメインに変えて再デプロイする。

ドメインを変えると、それまでに登録したパスキーは使えなくなる（パスキーの RP ID はドメイン単位のため）。会員はパスキーを登録し直す必要がある。

## トラブルシューティング

| 症状 | 対処 |
| --- | --- |
| `デプロイ先のFirebaseプロジェクトが設定されていません` | `firebase use` で `default` が設定されているか確認する。無ければ `firebase use --add` を実行する |
| `stamps:check` で止まる | `npm run stamps:sync` で取り込み、差分をコミットしてから再実行する |
| `Secret ... not found`／シークレットの権限エラー | `npm run deploy:init` を一度実行するか、Twilio のシークレットを手動で設定する |
| `Permission denied`／API が有効でない | 数分待って再実行する。解決しなければ、ログインしているアカウントのロールを確認する |
| `tsc` や `ng build` が失敗する | `node_modules` が古い可能性がある。`npm install && npm --prefix functions install` を実行し直す |
