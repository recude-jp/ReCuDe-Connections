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
| Node.js（22 以上。Cloud Functions の実行環境は Node 22） | ビルド | `node -v` |
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
npm --prefix functions run migrate:privacy -- --yes           # 電話番号を private/login へ移し、プロフィールを非公開(未設定)にする
npm --prefix functions run migrate:membership -- --yes        # 区分の無い会員に正規の会員の区分(member)を書き入れる(出会いを探すの検索に必要)
```

`migrate:privacy` のあとは、会員のプロフィールはいったんすべて非公開になる（公開・非公開は、会員がマイページで項目ごとに選ぶ。SECURITY-DEVELOPMENT.md 7章）。会員に、マイページで公開範囲を選ぶよう案内する。

### A-4b. Storage の CORS 設定（一度だけ）

トークの画像は暗号化して Storage に置き、端末で取得して復号する（SECURITY-DEVELOPMENT.md 6-2）。ブラウザから Storage のファイルの中身を読むには、バケットに CORS の設定が必要（Emulator では不要）。[`storage-cors.json`](storage-cors.json) の `origin` にアプリを開くドメインを入れて（独自ドメインを使う場合は追加する）、一度だけ実行する。

```bash
gcloud storage buckets update gs://<storageBucket> --cors-file=storage-cors.json
```

`<storageBucket>` は `src/environments/environment.prod.ts` の `storageBucket`（例: `default-41833.firebasestorage.app`）。設定していないと、暗号化した画像が「表示できません」になる。

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
5. Firebase Console > プロジェクトの設定 > サービスアカウント から秘密鍵（JSON）をダウンロードする。この鍵はリポジトリの外に置く。

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
- `SEED_ADMIN_PHONE` には、管理者の携帯電話番号を国際形式（`+81...`）で指定する。ログインの認証コードは、この番号に SMS で届く（Twilio が未設定の間は Cloud Functions のログに出る）。

### B-4. 生成されたファイルをコミットする

初期デプロイで書き換わったファイルをコミットしておく。コミットしないと、次にクローンした人がデプロイできない。

```bash
git add .firebaserc src/environments/environment.ts functions/.env.<プロジェクトID>
git commit -m "Configure Firebase project <プロジェクトID>"
```

以後の更新は **A-2** と同じく `npm run deploy` で行う。

---

## デプロイ後の確認

1. アプリの URL を開く。独自ドメインに切り替えた後は `https://<独自ドメイン>`、切り替える前は `https://<プロジェクトID>.web.app`（既存プロジェクトなら https://default-41833.web.app ）。
2. `/login` で管理者の電話番号を入力し、届いた認証コード（Twilio が未設定の間は Cloud Functions のログの `sendLoginCode`）でログインできることを確認する。
3. 管理者の番号でログインし、メニューに「管理」が出ること、`/admin` に入れることを確認する。
4. 招待を送り、Cloud Functions のログに招待リンクが出ることを確認する（Twilio が未設定の間は、実際の SMS は送られない。有効にする手順は → [SMS 機能を有効にする](#sms-機能を有効にする)）。
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

## SMS 機能を有効にする

このサービスの SMS（招待 SMS、ログインと参加の認証コード）は、すべて Cloud Functions から Twilio で送る（`functions/src/twilio.ts` の `sendSms`）。Twilio が未設定のときは送信されず、本文が Cloud Functions のログに出るだけになる。

| 用途 | 画面・処理 |
| --- | --- |
| 招待 SMS | 招待の送付・招待の申請の承認（`functions/src/invites.ts` の `issueInvite`） |
| ログインの認証コード | `/login` で SMS を選んだとき（`functions/src/loginAccount.ts` の `sendLoginCode`） |
| 参加の認証コード | `/join` の「認証コードを送信」（`functions/src/invites.ts` の `sendJoinCode`）。使える招待があるときだけ送る |

ログインの認証コードは、メール（Amazon SES）でも送れる → [メール送信を有効にする（Amazon SES）](#メール送信を有効にするamazon-ses)。

### ① Firebase Authentication の電話番号認証（使わない）

以前は参加（`/join`）の認証コードを Firebase Authentication の電話番号認証で送っていたが、Twilio に揃えた。Firebase の電話番号認証は使わないので、承認済みドメイン・reCAPTCHA・SMS リージョン ポリシーの設定は要らない。

- **テスト用の電話番号は登録しない**: Authentication > Sign-in method > 電話番号 > 「テスト用の電話番号」に番号が残っていたら消す。Firebase の電話番号認証を直接呼ばれると、その番号の会員として固定コードでログインできてしまうため（2026-10-12 に、本番に残っていた管理者の番号を削除した）。
- 電話番号プロバイダは「有効」のままでよい（Cloud Functions が電話番号付きの Firebase Auth ユーザーを作るため）。

### ② 招待 SMS（Twilio）

1. **Twilio のアカウントを用意する**: [Twilio](https://www.twilio.com/) でアカウントを作り、**有料アカウントにアップグレードする**。トライアルのままだと、Twilio に登録（認証）済みの番号にしか送れず、本文の先頭にトライアルの文言が付く。
2. **日本あての送信を許可する**: Twilio Console > Messaging > Settings > **Geo permissions** で **Japan** にチェックを入れる。
3. **送信元を用意する**: 日本あてには、**海外の電話番号**（例: アメリカの番号）を送信元にする。事前の登録が要らず、すぐ使える（2026年10月時点の [Twilio の国別ガイドライン（Japan）](https://www.twilio.com/en-us/guidelines/jp/sms)）。
   1. Twilio Console > **Phone Numbers > Manage > Buy a number** を開く。
   2. Country: **United States**、Capabilities: **SMS** にチェックして検索し、番号を1つ選んで「Buy」を押す（月額の番号料金がかかる）。アメリカの企業登録（A2P 10DLC）の案内が出ても、日本あてだけに送るなら不要。
   3. 購入した番号を `+1...` の形（ハイフン・空白なし）で控える。手順 5 の `TWILIO_FROM_NUMBER` に使う。
   - 会員には海外の番号から届く（au では先頭に `010` が付く）。本文の先頭にサービス名が入るので、会員に送信元の番号を案内しておく。
   - 英数字の送信者名（例: `TGCONNECT`）で送るには、Twilio の営業を通じて国内向けの経路を申し込む（事前登録が必要で、約5週間かかる）。
   - 日本あての SMS では、本文に電話番号を入れられない。
4. **認証情報を控える**: Twilio Console のトップページで、**Account SID** と **Auth Token** を確認する。
5. **Firebase のシークレットに登録する**（コマンドを実行すると値の入力を求められる）。
   ```bash
   firebase functions:secrets:set TWILIO_ACCOUNT_SID --project <プロジェクトID>   # AC で始まる Account SID
   firebase functions:secrets:set TWILIO_AUTH_TOKEN --project <プロジェクトID>    # Auth Token
   firebase functions:secrets:set TWILIO_FROM_NUMBER --project <プロジェクトID>   # 送信元（電話番号は +1... のように E.164 形式で）
   ```
6. **再デプロイする**: `npm run deploy` を実行して、関数に新しいシークレットを反映させる。
7. **招待リンクの URL を確認する**: SMS 本文に載るリンクは `functions/.env.<プロジェクトID>` の `APP_BASE_URL` から作られる（既存プロジェクトなら `https://default-41833.web.app`）。独自ドメインを使うなら、先にこちらを変えておく（→ [独自ドメインへの切り替え](#独自ドメインへの切り替え)）。
8. **動作確認**: アプリから、実際の携帯番号あてに招待を送る。SMS が届くこと、本文のリンクから `/join` を開けることを確認する。届かないときは、次の 2 つを確認する。
   - `firebase functions:log --project <プロジェクトID>` に `SMS未送信` と出ている場合: シークレットが空か `unset` のまま。手順 5〜6 をやり直す。
   - Twilio Console > Monitor > Logs > Messaging: 送信の状態とエラーコード（例: Geo permissions による拒否）を確認する。

補足:

- シークレットに実際の値を設定した後は、`deploy-init.sh` も `deploy.sh` もその値を上書きしない。
- 招待 SMS の送信を止めたい（ログに出すだけに戻したい）ときは、`TWILIO_ACCOUNT_SID` に `unset` を設定し直して、再デプロイする。
- Auth Token を再発行したときは、手順 5 の `TWILIO_AUTH_TOKEN` を設定し直して、再デプロイする。
- メール（ログインの認証コード・メールアドレスの確認・メールでの招待）は、Amazon SES で送る → 次の節。

## メール送信を有効にする（Amazon SES）

ログインの認証コード・メールアドレスの登録の確認コード・メールでの招待は、Cloud Functions から Amazon SES で送る（`functions/src/mail.ts`）。SES の認証情報か差出人が未設定の間は、実際には送らず、本文が Cloud Functions のログに出るだけ。

設定の手順は [`SES-SETTING.md`](SES-SETTING.md) にまとめた。

## 独自ドメインへの切り替え

アプリの URL を `https://<プロジェクトID>.web.app` から独自ドメインのホスト名（以下、例として `connect.example.jp`）に切り替える手順。

### ドメインに依存している箇所

ドメインを変えると、次のものに影響する。手順では、これらをまとめて設定する。

| 箇所 | 設定場所 | 影響 |
| --- | --- | --- |
| アプリの配信 | Firebase Console > Hosting > カスタムドメイン | 独自ドメインでアプリを開けるようにする |
| 招待 SMS・招待メールのリンク | `functions/.env.<プロジェクトID>` の `APP_BASE_URL` | リンクのドメインになる |
| パスキー（WebAuthn） | 同じく `APP_BASE_URL`（origin と RP ID をここから作る。`functions/src/webauthn.ts`） | この値と違うドメインでは、パスキーの登録もログインもできない |
| API キーの制限（設定している場合） | Google Cloud Console > API とサービス > 認証情報 | 許可されていないドメインからは、Firebase への接続が拒否される |

`src/environments/environment.ts` の `authDomain`（`<プロジェクトID>.firebaseapp.com`）は、**変えなくてよい**。この値を使うのはリダイレクト方式のログイン（Google ログインなど）で、電話番号でのログインには関係しない。

### 1. ホスト名を決める

- `connect.example.jp` のような**サブドメイン**を推奨する。ドメインそのもの（`example.jp`）も使えるが、ほかの用途（会社のサイトやメール）とぶつかりやすい。
- 一度決めたら変えない。変えるたびに、会員はパスキーを登録し直すことになる（→ 手順 7）。

### 2. Firebase Hosting にドメインを追加する

1. Firebase Console > **Hosting** > 「カスタムドメインを追加」を開く。
2. ホスト名（`connect.example.jp`）を入力する。「既存のウェブサイトにリダイレクトする」には**チェックを入れない**。
3. 表示された DNS レコードを控える。通常は、次の 2 種類が表示される。
   - **TXT レコード**: ドメインの所有者であることの確認用
   - **A レコード**（IP アドレスが 1 つか 2 つ）: アクセスを Firebase に向けるためのもの

   表示される内容はドメインや時期によって変わるので、**画面に出たものをそのまま**使う。

### 3. お名前.com の DNS にレコードを登録する

ドメインは**お名前.com**で管理している。お名前.com Navi で、手順 2 で控えたレコードを登録する。

#### 3-1. ネームサーバーを確認する（最初に必ず確認する）

お名前.com の「DNS レコード設定」が効くのは、ドメインのネームサーバーが**お名前.com のもの**（`01.dnsv.jp`〜`04.dnsv.jp`）になっているときだけ。まず、今のネームサーバーを確認する。

```bash
dig +short NS example.jp
```

- **`0x.dnsv.jp` が返る場合**: そのまま 3-2 に進む。
- **`dns1.onamae.com`・`dns2.onamae.com` が返る場合**（お名前.com の初期設定。ドメインを取っただけで、まだ何にも使っていない状態）: 3-2 に進む。確認画面に出る「DNSレコード設定用ネームサーバー変更確認」には**チェックを入れて**よい。
- **それ以外が返る場合**（レンタルサーバーや他社 DNS のネームサーバー）: レコードは、**そのネームサーバーを提供しているサービス**の管理画面で登録する。お名前.com の DNS レコード設定で登録しても、反映されない。

> **注意**: 3 つ目のケースで、DNS レコード設定の確認画面に「DNSレコード設定用ネームサーバー変更確認」というチェックボックスが出ることがある。これにチェックを入れて設定すると、ネームサーバーがお名前.com のものに切り替わる。その結果、今ほかのネームサーバーで使っているレコード（会社のサイトやメールの MX など）が**すべて効かなくなる**。既存のレコードを確認し、移し終えるまでは、チェックを入れないこと。

#### 3-2. レコードを追加する

1. [お名前.com Navi](https://navi.onamae.com/) にログインする。
2. 上部メニューの「**ネームサーバーの設定**」>「**ドメインの DNS 設定**」を開き、対象のドメイン（`example.jp`）を選んで「次へ」を押す。
3. 「**DNS レコード設定を利用する**」の「設定する」を押す。
4. 「A/AAAA/CNAME/MX/NS/TXT/SRV/DS/CAA レコード」の入力欄で、手順 2 で控えたレコードを 1 行ずつ追加する（「追加」を押すと下の一覧に入る）。

   | ホスト名 | TYPE | TTL | VALUE |
   | --- | --- | --- | --- |
   | `connect` | TXT | 3600 | Firebase の画面に表示された値（`hosting-site=...` など） |
   | `connect` | A | 3600 | Firebase の画面に表示された IP アドレス（1 つ目） |
   | `connect` | A | 3600 | Firebase の画面に表示された IP アドレス（2 つ目。表示された場合のみ） |

   - **ホスト名**の欄には、ドメイン部分（`.example.jp`）を**除いた部分だけ**を入力する（`connect`）。欄の右にドメイン名が表示されている。Firebase の画面で TXT のホスト名が `_acme-challenge.connect` のように別の名前になっているときは、その名前（ドメイン部分を除く）を入れる。
   - **VALUE** は、前後に空白や引用符を付けずに、そのまま貼り付ける。
   - ドメインそのもの（`example.jp`）を使う場合は、ホスト名を**空欄**にする。

5. 同じページの一覧で、ホスト名が `connect` の**既存の A・AAAA・CNAME レコード**があれば、「状態」のチェックを外して削除する。お名前.com のドメインパーキングや転送設定で自動的に作られたレコードが残っていることがある。
6. CAA レコードが登録されている場合は、ホスト名 `connect`（またはドメイン全体）に次の 2 行を追加する。

   | ホスト名 | TYPE | VALUE |
   | --- | --- | --- |
   | `connect` | CAA | `0 issue "letsencrypt.org"` |
   | `connect` | CAA | `0 issue "pki.goog"` |

7. 「確認画面へ進む」→ 内容を確認して「**設定する**」を押す。
8. 「**ドメインの転送設定**」（URL 転送）を `connect.example.jp` に設定していないかも確認する。設定していれば解除する。

#### 3-3. 反映を確認する

お名前.com のネームサーバーに登録されたことを直接確認してから、一般の DNS への反映を確認する。

```bash
# お名前.com のネームサーバーに直接問い合わせる（設定の直後から返る）
dig +short TXT connect.example.jp @01.dnsv.jp
dig +short A   connect.example.jp @01.dnsv.jp

# 一般の DNS への反映（TTL の分だけ、最大で数時間かかることがある）
dig +short TXT connect.example.jp
dig +short A   connect.example.jp   # Firebase の画面に表示された IP アドレスだけが返ること
```

`@01.dnsv.jp` への問い合わせで値が返らない場合は、登録の手順を見直す（「設定する」まで押したか、ホスト名にドメイン部分まで入れていないか）。

### 4. 接続と SSL 証明書の発行を待つ

Firebase Console > Hosting のドメイン一覧で、状態が「**接続済み**」になるまで待つ。DNS の反映と SSL 証明書の発行には、数分から最大 24 時間ほどかかる。

```bash
curl -I https://connect.example.jp   # HTTP/2 200 が返れば OK
```

この時点で、独自ドメインでもアプリは開ける。ただし、手順 5〜6 が終わるまでは、SMS ログインとパスキーは使えない。

### 5. Firebase Authentication と API キーの設定

1. Firebase Console > **Authentication** > 設定 > **承認済みドメイン** > 「ドメインの追加」で、`connect.example.jp` を追加する。`<プロジェクトID>.web.app` と `firebaseapp.com` は、移行の間に古い URL で開いた人のために残しておく。
2. [Google Cloud Console](https://console.cloud.google.com/apis/credentials?project=default-41833) > API とサービス > **認証情報** で、`Browser key (auto created by Firebase)` を開く。「アプリケーションの制限」が「ウェブサイト」になっている場合は、`https://connect.example.jp/*` を追加する。「なし」の場合は、何もしなくてよい。

### 6. `APP_BASE_URL` を変えて再デプロイする

`functions/.env.<プロジェクトID>`（既存プロジェクトなら `functions/.env.default-41833`）を書き換える。

```dotenv
APP_BASE_URL=https://connect.example.jp
```

- 末尾に `/` を付けない。
- `https://` から書く。

書き換えたら、コミットして再デプロイする。

```bash
git add functions/.env.default-41833
git commit -m "Switch APP_BASE_URL to connect.example.jp"
npm run deploy
```

これで、招待 SMS のリンクとパスキーの検証が、新しいドメインを使うようになる。

### 7. 動作確認

新しいドメイン（`https://connect.example.jp`）で、次のことを確認する。

1. アプリが開き、ブラウザのアドレスバーに鍵マークが出る（SSL が有効）。
2. `/login` で SMS の認証コードが届き、ログインできる。
3. マイページからパスキーを登録し、ログアウトしてから、パスキーでログインできる。
4. 招待を送ると、SMS（またはログ）のリンクが `https://connect.example.jp/join...` になっている。

### 8. 既存の会員への影響と周知

ドメインを変えると、次のことが起きる。切り替えの前に、会員に新しい URL を知らせておく。

- **パスキー**: 古いドメイン（`web.app`）で登録したパスキーは、新しいドメインでは使えない。さらに切り替えの後は、古いドメインでもパスキーは使えなくなる（`APP_BASE_URL` と一致しないため）。会員は、新しいドメインで SMS でログインしてから、パスキーを登録し直す。
- **PIN**: 端末の登録情報はブラウザにドメインごとに保存されているので、新しいドメインでは PIN を設定し直す必要がある。
- **ホーム画面のアイコン（PWA）**: 古いアイコンは `web.app` を開くので、新しいドメインで開いてから、アイコンを追加し直してもらう。
- **古い URL**: `https://<プロジェクトID>.web.app` は切り替えの後も開ける（SMS ログインもできる）。すでに送った招待リンクも、そのまま使える。ただし、古い URL から新しいドメインへの自動転送は、Firebase Hosting の設定だけではできない。転送が必要なら、アプリ側に「`web.app` で開かれたら新しいドメインに移る」処理を追加する必要がある（未実装）。

## トラブルシューティング

| 症状 | 対処 |
| --- | --- |
| `デプロイ先のFirebaseプロジェクトが設定されていません` | `firebase use` で `default` が設定されているか確認する。無ければ `firebase use --add` を実行する |
| `stamps:check` で止まる | `npm run stamps:sync` で取り込み、差分をコミットしてから再実行する |
| `Secret ... not found`／シークレットの権限エラー | `npm run deploy:init` を一度実行するか、Twilio のシークレットを手動で設定する |
| `Permission denied`／API が有効でない | 数分待って再実行する。解決しなければ、ログインしているアカウントのロールを確認する |
| ログイン・参加の認証コードの SMS が届かない | [SMS 機能を有効にする](#sms-機能を有効にする) の②（Twilio）を確認する。Cloud Functions のログ（`sendLoginCode`・`sendJoinCode`）にエラーが出ていないかも見る |
| 招待 SMS が届かない | 同じく②を確認する（Cloud Functions のログと Twilio のログ） |
| 独自ドメインが「接続済み」にならない | `dig NS example.jp` のネームサーバーが `0x.dnsv.jp` か、お名前.com に古い A・AAAA・CNAME や URL 転送が残っていないか、CAA で証明書の発行元が拒否されていないかを確認する（[独自ドメインへの切り替え](#独自ドメインへの切り替え)の手順 3） |
| 独自ドメインでパスキーが使えない | `APP_BASE_URL` が新しいドメインになっているか、再デプロイしたかを確認する（同じく手順 6） |
| `tsc` や `ng build` が失敗する | `node_modules` が古い可能性がある。`npm install && npm --prefix functions install` を実行し直す |
