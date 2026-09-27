# ReCuDe Connections 開発ガイド

ReCuDe Connections の開発環境構築・ローカル開発・デプロイ手順をまとめる。サービスの概要は [`README.md`](README.md)、基本設計は [`SPEC.md`](SPEC.md)、Firestoreのデータモデルは [`docs/firestore-data-model.md`](docs/firestore-data-model.md) を参照。

> **名称について**: プロジェクト名は ReCuDe Match から ReCuDe Connections に変更した。ただしリポジトリ・パッケージ名（`recude-match`）、Angularプロジェクト名、Emulator用のプロジェクトID（`demo-recude-match`）、ビルド出力先（`dist/recude-match/`）などの技術的な識別子は現時点では旧名のままである。以下の手順中のこれらの値はそのまま使うこと。

## 技術スタック

- フロントエンド: Angular 21（standalone components） + `@angular/fire`
- バックエンド: Firebase（Authentication, Firestore, Cloud Functions, Storage）
- SMS送信: Twilio（`functions/src/twilio.ts`。未設定時はCloud Functionsのログ出力のみに自動フォールバック）
- ローカル開発: Firebase Local Emulator Suite

## セットアップ

```bash
npm install
npm --prefix functions install
```

## ローカル開発（Firebase Emulator使用）

本番のFirebaseプロジェクトを作成していなくても、Emulator Suite上で一通りの動作確認ができる。

1. Cloud Functionsをビルドする

   ```bash
   npm --prefix functions run build
   ```

2. Emulatorを起動する（別ターミナル）

   ```bash
   firebase emulators:start --project demo-recude-match --import=./emulator-data --export-on-exit=./emulator-data
   ```

   `--import`/`--export-on-exit` により、`emulator-data/`（gitignore済み・初回は自動作成）にFirestore/Authのデータが保存され、Emulatorを終了（Ctrl+C）すると自動でエクスポート、次回起動時に自動で読み込まれる。データを再現性のあるまっさらな状態に戻したい場合は `rm -rf emulator-data` してから起動する。

   起動後、Emulator UI（`http://localhost:4000`）でFirestore/Authの中身を確認できる。

3. サンプルデータを投入する（初回のみ。Emulator起動中に別ターミナルで実行）

   ```bash
   GCLOUD_PROJECT=demo-recude-match npm --prefix functions run seed
   ```

   投入されるデータ: テナント `東京岐阜県人会`（`tenants/gifu-tokyo`、サービス名: TOKYO GIFU CONNECT）と、下の「[テスト会員](#テスト会員emulator)」の6人・つながり・トークのルーム・メッセージ・グループ招待。

   上記の`--import`/`--export-on-exit`運用にしていれば、2回目以降の起動では投入済みデータがそのまま復元されるため再実行は不要（`emulator-data/`を削除した場合のみ再実行する）。再実行すると、会員とトーク（ルーム・つながり・トーク一覧・グループ招待）は投入時の状態に戻る（テスト中に作ったグループやメッセージは消える。パスキー・PINの登録は残る）。

4. Angularアプリを起動する（別ターミナル）

   ```bash
   npm start
   ```

   `http://localhost:5300` を開く（ほかの開発サーバーとぶつかりやすい 4200 を避けて、`angular.json` の `serve.options.port` で 5300 にしている。変えるときは `functions/.env` の `APP_BASE_URL` も合わせる。パスキーの確認と招待リンクに使うため）。開発ビルドは自動的にEmulatorへ接続する（`src/environments/environment.development.ts` の `useEmulators: true`）。

### エントリポイント一覧（Emulator使用時）

| サービス | URL | 用途 |
| --- | --- | --- |
| Angularアプリ（開発用） | http://localhost:5300 | `npm start`（`ng serve`）。ソース保存で自動リビルド・反映される |
| Hosting Emulator（`dist/`配信） | http://127.0.0.1:5050 | `npm run build`済みの静的ビルドを配信。ソース変更は自動反映されない |
| Emulator Suite UI | http://127.0.0.1:4000 | 全Emulatorの管理ダッシュボード |
| Authentication Emulator | http://127.0.0.1:9099 | UIは `http://127.0.0.1:4000/auth` |
| Firestore Emulator | http://127.0.0.1:8080 | UIは `http://127.0.0.1:4000/firestore` |
| Storage Emulator | http://127.0.0.1:9199 | UIは `http://127.0.0.1:4000/storage` |
| Cloud Functions Emulator | http://127.0.0.1:5001/demo-recude-match/us-central1/&lt;関数名&gt; | 関数を直接HTTP呼び出しする場合。一覧は `http://127.0.0.1:4000/functions` |

開発時はAngularアプリとして `http://localhost:5300` を使う（`http://127.0.0.1:5050` はビルド済み成果物の確認用）。

### テスト会員（Emulator）

`npm --prefix functions run seed` で作られる会員。どの会員も `/login` に電話番号（ハイフンあり・なし、E.164形式のどれでも可）を入れてログインできる。認証コードの確認方法は下の「ログイン確認手順」を参照。一覧は [`functions/scripts/seed.ts`](functions/scripts/seed.ts) の `MEMBERS` と揃えること。

| 電話番号 | 表示名 | ロール | 役職・年代（生年月） | プロフィール（出身地・高校） | 確認に向いていること |
|---|---|---|---|---|---|
| `090-1234-5678` | 山田太郎 | 管理者・認定推薦者 | 一般会員・30代（1992-08） | 岐阜市・岐阜北高校 | 管理画面（プロフィール項目の設定を含む）、グループ招待への返事（週末スキー部）、コネクト申請の承認（高橋美咲から） |
| `090-1234-5679` | 佐藤花子 | — | 一般会員・20代（2000-03） | 大垣市・大垣北高校 | 一般会員としてのトーク |
| `090-1234-5680` | 鈴木一郎 | 認定推薦者 | 幹部・50代（1972-11） | 高山市・斐太高校 | 例文の敬語（相手が幹部）、グループ管理者（東京で釣り部） |
| `090-1234-5681` | 高橋美咲 | — | 一般会員・20代（1996-09。2026-10から30代） | 岐阜市・岐阜北高校 | 送信中のコネクト申請（山田太郎あて） |
| `090-1234-5682` | 田中健太 | 認定推薦者 | 会長・40代（1983-04） | 多治見市・多治見北高校 | 例文の敬語（相手が会長）、グループ管理者（週末スキー部） |
| `090-1234-5683` | 伊藤ゆき | — | 一般会員・20代（2002-09） | 関市・関高校 | グループ招待への返事（岐阜北高OB・OG会） |
| `090-1234-5684` | 小林翔 | **ゲスト**（会員申請の審査待ち） | 一般会員・20代（1999-12） | 各務原市・各務原高校 | 管理 > 会員申請 での承認・否認（山田太郎がQRコードで招待） |
| `090-1234-5685` | 加藤りん | **ゲスト**（未申請） | — | — | ゲストの画面（会員登録からの申請、使える機能の範囲。佐藤花子が招待） |
| `090-1234-5686` | 中村あおい | **連携コミュニティだけ**（岐阜北高校 在京同窓会） | 一般会員・20代（2003-06） | — | 連携コミュニティのメンバーの画面（ヘッダのロゴ、招待先は同窓会だけ、ルートではゲストと同じ制限。高橋美咲がQRコードで招待） |

投入されるトーク:

| 種類 | 名前 | メンバー（★はグループ管理者） | 招待中 |
|---|---|---|---|
| グループ | 岐阜北高OB・OG会 | ★山田太郎、佐藤花子、★高橋美咲 | 伊藤ゆき（高橋美咲が招待） |
| グループ | 東京で釣り部 | ★鈴木一郎、山田太郎、伊藤ゆき | — |
| グループ | 週末スキー部 | ★田中健太、高橋美咲 | 山田太郎（田中健太が招待） |
| 1対1 | — | 山田太郎 ↔ 佐藤花子、山田太郎 ↔ 鈴木一郎、鈴木一郎 ↔ 高橋美咲、田中健太 ↔ 伊藤ゆき | — |

- つながり申請: 高橋美咲 → 山田太郎（未対応）。山田太郎が「つながる > 出会いを探す」で検索し、高橋美咲の行の「承認する」を押すと、1対1のトークができる。
- グループ管理者は複数人にでき、唯一のグループ管理者は退出できない。「東京で釣り部」の鈴木一郎、「週末スキー部」の田中健太は唯一のグループ管理者のため退出できない（岐阜北高OB・OG会は2人いるので、どちらも退出できる）。最後の1人のメンバーは退出でき、そのときグループは削除される（退出前に確認が出る）。
- メッセージには、スタンプ（こまめ・ルミ・ルカ）とリアクションの例も入れてある。送った画像は Storage Emulator に保存され、投入し直すと消える。マイスタンプ（マイページ > マイスタンプ）は投入し直しても残る（パスキー・PINと同じ、会員ごとの登録のため）。
- 招待から参加する流れを試すには、会員（山田太郎など）の「つながる > 招待」に出るQRコードのリンク（`http://localhost:5300/join?code=…`）を、シークレットウィンドウなどで開き、まだ登録していない電話番号（例: `090-9999-0001`）でログインする。「招待の送付」の招待リンクは、SMS・メールとも実際には送らず、EmulatorのFunctionsのログに本文が出る。
- 連携コミュニティ「岐阜北高校 在京同窓会」: 管理者は山田太郎、メンバーは山田太郎・高橋美咲・中村あおい（3人。うちルートの会員でもある人2人）。管理 > 連携コミュニティ で追加・編集・削除を試せる。山田太郎・高橋美咲は「つながる > 招待」で招待先を選べる。同窓会へのQRコードのリンクを、まだ登録していない電話番号で開くと、連携コミュニティだけのメンバーとして参加する。登録済みの会員がログインしたまま開くと、その連携コミュニティが所属に加わる。
- 管理画面は対象のコミュニティごと（`/admin/root/...`・`/admin/{連携コミュニティのID}/...`）。山田太郎はルートの管理者なので、見出しの横のメニューでルートと全部の連携コミュニティを切り替えられる。連携コミュニティだけの管理者（管理者に任命した人）は、その連携コミュニティの管理画面だけに入れる（任命・解除のあとは、ログインし直すとメニューに反映される）。
- コミュニティのスタンプ: 管理 > スタンプ で、ルートコミュニティ・連携コミュニティごとにパックを作ってスタンプを登録し、「会員に公開する」にして保存すると、使える会員のスタンプパネルに出る（投入では作らない。登録したパックと画像は、投入し直しても残る）。
- 生年月は非公開の項目（本人と管理者だけが見られる）で、年代は生年月から自動で決まる（誕生月の翌月から切り替わる）。高橋美咲（1996-09）は、2026年9月は20代、10月から30代になる（毎月1日の `recomputeDerivedProfiles` か、本人がプロフィールを保存したときに更新）。
- 複数の会員で同時に確認するときは、会員ごとに別のブラウザ（または Chrome のプロフィール・シークレットウィンドウ）でログインする。同じブラウザのタブでは、ログインが共有される。

### ログイン確認手順（Emulator）

- 会員ログイン（`/login`）: `090-1234-5678`（またはE.164形式）を入力して送信すると、Auth Emulatorが認証コードを発行する。実際のSMSは送信されないため、コードは次のURLで確認する（配列の最後＝最新のものを使う）。
  ```
  http://localhost:9099/emulator/v1/projects/demo-recude-match/verificationCodes
  ```
- 管理画面: 管理者は会員と同じ `/login` からログインする（事務局専用のメール・パスワードログインは廃止）。山田太郎でログインすると、メニューバーに「管理」が表示され、`/admin`（会員一覧・サービス設定）に入れる。
- 招待SMSの本文はTwilio未設定のためEmulatorのFunctionsログにそのまま出力される（招待リンクの確認に使う）。

## GCPへの確認用デプロイ

開発モードでの機能確認のため、Twilioは実際には設定せず、招待SMSはCloud Functionsのログ出力にとどめる。会員ログイン自体（Firebase Authenticationの電話番号認証）は本物のFirebaseプロジェクトの機能なので、実SMSを送らずに確認するには「テスト用の電話番号」をFirebase Console側に登録しておく。

### 事前準備（手動・一度だけ）

1. [Firebase Console](https://console.firebase.google.com/) でプロジェクトを新規作成する（Googleアカウントでのログインが必要なため、ここは開発者自身で行う）。
2. `firebase login` でCLIにログインする。
3. プロジェクトルート（`ReCuDe-Connections/`）で `firebase use --add` を実行し、作成したプロジェクトを **エイリアス名 "default"** で紐づける（デプロイスクリプトが`.firebaserc`の`default`を読むため）。
4. Firebase Console > Authentication > Sign-in method で「電話番号」プロバイダを有効化する。
5. 同じ画面下部の「テスト用の電話番号」に、確認に使う電話番号と固定OTPコード（例: `090-0000-0001` / `123456`）を登録する。実SMSを送らずにログイン確認できるようになる。
6. Firebase Console > プロジェクトの設定 > サービスアカウント から秘密鍵（JSON）をダウンロードする（本番シードスクリプトで使用。取り扱いに注意し、リポジトリにコミットしないこと）。

### 初期デプロイ

```bash
npm run deploy:init
```

[`scripts/deploy-init.sh`](scripts/deploy-init.sh) が以下を自動で行う。

- Web App登録の確認・作成と、`src/environments/environment.ts` への実際のFirebase設定値の反映
- Firestoreデータベースの作成（未作成の場合。デフォルトリージョンは`asia-northeast1`。`FIRESTORE_LOCATION`環境変数で変更可）
- Twilioの3つのシークレット（`TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM_NUMBER`）に、未設定であればプレースホルダー`"unset"`を登録（Cloud Functions v2の`secrets`はSecret Manager上に値が無いとデプロイ自体ができないための対応。`functions/src/twilio.ts`はこのプレースホルダーを「未設定」として扱い、実送信をスキップしてログ出力のみ行う）
- 招待SMSに載せるURL（`APP_BASE_URL`）を実際のHosting URLに設定（`functions/.env.<プロジェクトID>`を生成）
- 依存関係インストール、Cloud Functions/Angularのビルド、`firebase deploy`

初回は`続行しますか？ [y/N]`の確認が入る（`npm run deploy:init -- --yes`で省略可能）。

### 本番データの投入

テナントのセットアップとして、初期デプロイ後に一度だけ実行する。1回の実行で、テナント（組織名・サービス名）と最初の管理者ユーザーを作る。管理者は「会員＋管理者ロール」のため、会員として作成され、管理者ロールと認定推薦者ロールが付く。2人目以降の管理者は、管理画面の会員一覧から任命する。

```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
GCLOUD_PROJECT=<プロジェクトID> \
SEED_TENANT_ID=gifu-tokyo \
SEED_TENANT_NAME="東京岐阜県人会" \
SEED_SERVICE_NAME="TOKYO GIFU CONNECT" \
SEED_ADMIN_PHONE=+819000000000 \
SEED_ADMIN_NAME="山田太郎" \
npm --prefix functions run seed:prod -- --yes
```

- `SEED_TENANT_ID`は、`src/environments/environment.ts` の `tenantId`（初期デプロイで入力したテナントID。確認用デプロイでは `tokyo-gifu-connect`）と同じ値にすること。違うと、ログイン画面がテナントを見つけられない。
- `SEED_ADMIN_PHONE`には、事前準備でFirebase Consoleに登録した「テスト用の電話番号」と同じ番号を指定すること。
- `SEED_SERVICE_NAME`は省略すると組織名になる。アイコン（ロゴ画像）は、ログイン後に管理画面のサービス設定から登録する。
- 同じ電話番号で再実行した場合は、既存の会員に管理者ロールを付け直す（会員は重複して作られない）。

### 動作確認

1. デプロイ完了時に表示される`https://<プロジェクトID>.web.app`を開く。
2. `/login`でテスト用電話番号とその固定OTPコードを入力してログインできることを確認する。
3. 管理者の電話番号でログインすると、メニューバーに「管理」が表示され、管理画面（`/admin`）に入れることを確認する。
4. 会員が別の電話番号を招待すると、実SMSは送信されず、招待リンク本文がCloud Functionsのログに出力される。以下のいずれかで確認する。
   ```bash
   firebase functions:log --project <プロジェクトID>
   ```
   またはGCP ConsoleのLogs Explorerで`resource.type="cloud_run_revision"`かつ`SMS未送信`を含むログを検索する。
5. ログから招待リンク（`https://<プロジェクトID>.web.app/join`）をコピーし、招待された側の電話番号（あらかじめFirebase Consoleに「テスト用の電話番号」として登録しておく）でアクセスして登録フローを確認する。

### 差分デプロイ（日常の更新）

初期デプロイ後、コードを変更したら以下だけでよい。

```bash
npm run deploy
```

[`scripts/deploy.sh`](scripts/deploy.sh) はビルドと`firebase deploy`のみを行う（Web App登録やFirestore作成などの初期セットアップは行わない）。

- 使わなくなった関数（例: `decideInvite`・`getInviteStatus`・`submitCandidateProfile`）が本番に残っていると、デプロイの途中で「削除しますか」と聞かれる。`y` で削除する。
- Firestore のトリガー（`onRoomMessageCreated`）は、データベースと同じリージョン（`asia-northeast1`）に置いている。呼び出し型の関数は `us-central1`。
- 初めてトリガー・定期実行の関数（`recomputeDerivedProfiles`）をデプロイするときは、必要なAPI（Eventarc・Pub/Sub・Cloud Scheduler）が自動で有効になる。権限の反映待ちで失敗したら、数分おいて `npm run deploy` をもう一度実行する。

### 共通スタンプの追加・差し替え

`stamps/` の素材を変えたら `npm run stamps:sync` で取り込み、画面で確かめてからコミットし、デプロイする。デプロイの最初に `npm run stamps:check` が走り、取り込み忘れがあると止まる。詳しい手順（追加・差し替え・文言の修正・廃止・ロールバック）は [`docs/stamps.md`](docs/stamps.md)。

### プロフィールの移行（テナントごとのプロフィール項目・一度だけ）

プロフィールを「テナントごとのプロフィール項目」方式に変えたため、この版を初めてデプロイしたあとに一度だけ実行する。会員（と招待）の旧項目（出身地・出身高校・出身中学・部活動・趣味・年代）を `member.profile` に移し、テナントにプロフィール項目が無ければ同じ6項目を作る（何度実行しても同じ結果になる）。

```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
GCLOUD_PROJECT=<プロジェクトID> \
npm --prefix functions run migrate:profile -- --yes
```

Emulatorで試すときは `GCLOUD_PROJECT=demo-recude-match FIRESTORE_EMULATOR_HOST=localhost:8080 npm --prefix functions run migrate:profile`。

### 連携コミュニティの管理者の反映（一度だけ）

連携コミュニティの管理画面を入れる前に作った連携コミュニティの管理者（`adminIds`）を、会員データの `adminCommunityIds` とカスタムクレームに反映する（何度実行しても同じ結果になる）。

```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
GCLOUD_PROJECT=<プロジェクトID> \
npm --prefix functions run migrate:community-admins -- --yes
```

Emulatorで試すときは `GCLOUD_PROJECT=demo-recude-match FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 npm --prefix functions run migrate:community-admins`。

### 1対1チャットのルーム方式への移行（Step 2・一度だけ）

1対1チャットの保存先を `connections/{id}/messages` から `rooms/{id}/messages` に変えたため、Step 2 を初めてデプロイしたあとに一度だけ実行する。つながり成立済みのコネクションごとに、ルーム・メンバー・トーク一覧を作り、メッセージをコピーする（旧メッセージは消さない。何度実行しても同じ結果になる）。

```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
GCLOUD_PROJECT=<プロジェクトID> \
npm --prefix functions run migrate:rooms -- --yes
```

Emulatorで試すときは `GCLOUD_PROJECT=demo-recude-match FIRESTORE_EMULATOR_HOST=localhost:8080 npm --prefix functions run migrate:rooms`。

### 実際のSMS送信に切り替える場合

```bash
firebase functions:secrets:set TWILIO_ACCOUNT_SID --project <プロジェクトID>
firebase functions:secrets:set TWILIO_AUTH_TOKEN --project <プロジェクトID>
firebase functions:secrets:set TWILIO_FROM_NUMBER --project <プロジェクトID>
npm run deploy
```

実際の値を設定すればそれ以降`deploy-init.sh`・`deploy.sh`ともに上書きしない。Twilioアカウントの作成・電話番号取得はユーザー自身の作業が必要。

## 初回読み込みサイズの方針

ログイン前の画面（`/login`、SMSの招待リンクから開く`/join`）を軽く保つため、次のように分けている。

| 読み込むタイミング | 内容 | 主な提供場所 |
|---|---|---|
| 初回（全画面共通） | Angular本体、Firebase App・Auth・Functions | `src/app/app.config.ts` |
| 会員エリアに入ったとき | Firestore SDK（約440kB） | `src/app/member.routes.ts`（`app.routes.ts` から `loadChildren`） |
| 管理画面に入ったとき | Storage SDK（ロゴのアップロード） | `src/app/admin.routes.ts`（`member.routes.ts` から `loadChildren`） |

守ること:

- 画面はすべて standalone コンポーネントとし、ルートは `loadComponent`／`loadChildren` で遅延ロードする。
- Firestore・Storage を `inject` するサービスは `providedIn: 'root'` にせず、`@Injectable()` として上記のルートの `providers` に登録する（root にすると、ログイン前の画面から使えてしまい、SDKが初回読み込みに戻る）。
- ログイン前の画面では Firestore SDK を使わない。テナントの名称・ブランドは `PublicBrandingService`（Firestore REST API）で取得する。
- 会員エリア・管理画面のガードは `canMatch` にする（条件を満たさないときはチャンク自体を読み込まない）。

`angular.json` の初回読み込みの上限（警告 450kB／エラー 600kB）を超えたら、何が初回に入ったかを次で確認する。

```bash
npx ng build --stats-json
# dist/recude-match/stats.json を https://esbuild.github.io/analyze/ に読み込むと、チャンクごとの内訳を確認できる
```

## その他のAngular CLIコマンド

```bash
ng build         # 本番ビルド（dist/に出力）
ng test          # ユニットテスト（Vitest）
```
