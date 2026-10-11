# メール送信の設定（Amazon SES）

TOKYO GIFU CONNECT が会員に送るメールを、Amazon SES から送るための設定手順。

| 項目 | 内容 |
| --- | --- |
| 送るメール | ログインの認証コード、メールアドレスの登録の確認コード、メールでの招待、招待申請への招待 |
| 送る仕組み | Cloud Functions から SES の API で送る（`functions/src/mail.ts`） |
| 送信元のドメイン | `apgifu.org`（東京岐阜県人会のドメイン。SES で設定済み。DNS はお名前.com） |
| 差出人（予定） | `TOKYO GIFU CONNECT <noreply@connect.apgifu.org>` |
| Firebase プロジェクト | `default-41833` |

SES の認証情報か差出人が未設定の間は、メールは実際には送られず、本文が Cloud Functions のログに出るだけになる（`firebase functions:log --project default-41833` で確認できる）。

---

## 設定状況（2026-10-11 時点）

| 項目 | 状態 |
| --- | --- |
| SES のリージョン | `us-east-1`（バージニア北部。`apgifu.org` はここで検証済み） |
| `apgifu.org` の ID | 検証済み。DKIM は未設定のまま（ホームページ側の設定のため、このサービスでは触らない） |
| `connect.apgifu.org` の ID | 2026-10-11 に作成（Easy DKIM、RSA 2048bit）。お名前.com に DKIM の CNAME を3つ登録し、**検証済み・DKIM 成功** |
| 本番稼働用アクセス | 有効（サンドボックスではない。1日 50,000 通まで） |
| IAM ポリシー | `recude-connect-ses-send`（`noreply@connect.apgifu.org` からの `ses:SendEmail` だけを許可） |
| IAM ユーザー | `recude-connect-ses`（コンソールへのアクセスなし。上のポリシーだけ） |
| アクセスキー | 作成済み。Firebase のシークレットに直接登録した（値はどこにも表示・保存していない） |
| `functions/.env.default-41833` | `SES_REGION=us-east-1`、`MAIL_FROM=TOKYO GIFU CONNECT <noreply@connect.apgifu.org>` |
| デプロイ | 済み（メールの送信が有効） |
| 残り | 手順 4 の動作確認 |

`connect.apgifu.org` の DKIM の CNAME（お名前.com の `apgifu.org` に登録する）:

| ホスト名 | TYPE | VALUE |
| --- | --- | --- |
| `aige3vm4rtjwjtltdbtexbvnadnsvzr6._domainkey.connect` | CNAME | `aige3vm4rtjwjtltdbtexbvnadnsvzr6.dkim.amazonses.com` |
| `q5aafvmi57k5pcpx3ayqa3jfiiwmtxot._domainkey.connect` | CNAME | `q5aafvmi57k5pcpx3ayqa3jfiiwmtxot.dkim.amazonses.com` |
| `5ne6qe6gskyfawiqjt2e3kkm5c5m5fj4._domainkey.connect` | CNAME | `5ne6qe6gskyfawiqjt2e3kkm5c5m5fj4.dkim.amazonses.com` |

SES は、より詳しい ID（`connect.apgifu.org`）を優先して使う。そのため、この ID の検証が終わるまでの間は、`noreply@connect.apgifu.org` からの送信が失敗することがある。

---

## 設定する値

| 設定 | 置き場所 | 例 |
| --- | --- | --- |
| アクセスキー ID | Firebase のシークレット `AWS_SES_ACCESS_KEY_ID` | IAM ユーザーのアクセスキー |
| シークレットアクセスキー | Firebase のシークレット `AWS_SES_SECRET_ACCESS_KEY` | 同上 |
| リージョン | `functions/.env.default-41833` の `SES_REGION` | `ap-northeast-1`（東京） |
| 差出人 | 同じく `MAIL_FROM` | `TOKYO GIFU CONNECT <noreply@connect.apgifu.org>` |

---

## 1. SES の状態を確認する（AWS コンソール）

1. AWS コンソールの右上で、`apgifu.org` を設定した**リージョン**を選ぶ（例: アジアパシフィック（東京）＝ `ap-northeast-1`）。このリージョンを `SES_REGION` に使う。
2. **Amazon SES > ID（Identities）** を開き、`apgifu.org` が次の状態になっていることを確認する。
   - ID のステータス: **検証済み（Verified）**
   - DKIM: **成功（Successful）**

   ドメインを検証済みなら、そのサブドメインのアドレス（`noreply@connect.apgifu.org`）からも送れる。
3. **Amazon SES > アカウントダッシュボード** で、**本番稼働用アクセス（Production access）** が有効になっていることを確認する。
   - **サンドボックス**のままだと、SES で検証したアドレスあてにしか送れない（会員には届かない）。
   - サンドボックスの場合は、同じ画面の「本番稼働用アクセスをリクエスト」から申請する（用途: 会員制サービスの認証コード・通知メール。承認まで1日ほど）。

### （任意）サービス用の ID を分ける

ホームページのメールと送信の評判を分けたい場合や、迷惑メールに入りやすい場合は、`connect.apgifu.org` を別の ID として作る。

1. Amazon SES > ID > 「ID の作成」> 「ドメイン」で `connect.apgifu.org` を入力する。DKIM は「Easy DKIM」「RSA_2048_BIT」のままにする。
2. 表示される **CNAME レコード3つ**を、お名前.com の DNS に登録する。
   - お名前.com Navi > ネームサーバーの設定 > ドメインの DNS 設定 > `apgifu.org` > DNS レコード設定を利用する
   - ホスト名には、ドメイン部分（`.apgifu.org`）を除いた部分を入れる（例: `abcdefg._domainkey.connect`）
   - TYPE: `CNAME`、VALUE: SES の画面に表示された値（`xxxx.dkim.amazonses.com`）
3. SES の画面で、ID が「検証済み」になるまで待つ（数分〜数時間）。
4. 次の手順 2 のポリシーの `Resource` に、この ID の ARN も加える。

---

## 2. 送信だけを許可した IAM ユーザーを作る

アプリに渡す認証情報は、**このサービスの差出人から送ることだけ**ができるようにする（漏れたときの被害を小さくするため）。

### 2-1. ポリシーを作る

IAM > **ポリシー** > 「ポリシーの作成」> **JSON** に次を入れる。`<リージョン>`（例: `ap-northeast-1`）と `<アカウントID>`（12桁。コンソール右上のアカウント名から確認できる）を置き換える。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ses:SendEmail"],
      "Resource": ["arn:aws:ses:<リージョン>:<アカウントID>:identity/apgifu.org"],
      "Condition": {
        "StringLike": { "ses:FromAddress": "noreply@connect.apgifu.org" }
      }
    }
  ]
}
```

- ポリシー名の例: `recude-connect-ses-send`
- `connect.apgifu.org` を別の ID にした場合は、`Resource` に `"arn:aws:ses:<リージョン>:<アカウントID>:identity/connect.apgifu.org"` も加える。

### 2-2. ユーザーを作る

1. IAM > **ユーザー** > 「ユーザーの作成」。ユーザー名の例: `recude-connect-ses`
2. 「AWS マネジメントコンソールへのユーザーアクセスを提供する」には**チェックを入れない**。
3. 許可の設定で「ポリシーを直接アタッチする」を選び、2-1 のポリシー**だけ**を付ける。

### 2-3. アクセスキーを作る

1. 作ったユーザー > **セキュリティ認証情報** > 「アクセスキーを作成」
2. ユースケースは「**AWS の外部で実行されるアプリケーション**」を選ぶ。
3. 表示された**アクセスキー ID** と**シークレットアクセスキー**を控える。シークレットアクセスキーは、この画面でしか表示されない。

---

## 3. Firebase に設定する

### 3-1. アクセスキーをシークレットに入れる

アクセスキーは、チャット・メール・ファイルに貼らず、**自分のターミナルで**入力する（入力した値は画面に表示されない）。

```bash
firebase functions:secrets:set AWS_SES_ACCESS_KEY_ID --project default-41833
firebase functions:secrets:set AWS_SES_SECRET_ACCESS_KEY --project default-41833
```

### 3-2. リージョンと差出人を書く

`functions/.env.default-41833` の次の2行を書き換える（SES を設定するまでは、`SES_REGION=ap-northeast-1`・`MAIL_FROM=unset` が入っている）。

```dotenv
SES_REGION=ap-northeast-1
MAIL_FROM=TOKYO GIFU CONNECT <noreply@connect.apgifu.org>
```

### 3-3. 再デプロイする

```bash
git add functions/.env.default-41833
git commit -m "Configure Amazon SES for email"
npm run deploy
```

---

## 4. 動作確認

1. アプリにログインし、マイページ > **ログイン設定** で自分のメールアドレスを登録する。確認コードのメールが届くことを確認する。
2. 「ログインIDとしても使う」をオンにして、ログアウトする。
3. `/login` でメールアドレスを入力し、「メール」を選ぶ。認証コードのメールが届き、ログインできることを確認する。
4. 届いたメールの差出人が `TOKYO GIFU CONNECT <noreply@connect.apgifu.org>` になっていること、迷惑メールに入っていないことを確認する。

### 届かないとき

| 症状 | 原因と対処 |
| --- | --- |
| ログに `メール未送信: 配信サービス未設定` と出る | シークレットか `MAIL_FROM` が未設定。手順 3 をやり直して再デプロイする |
| ログに `MessageRejected`・`Email address is not verified` | SES がサンドボックスのまま（手順 1-3）か、差出人のドメインが検証済みでない |
| ログに `AccessDenied`・`not authorized to perform ses:SendEmail` | IAM のポリシーのリージョン・アカウント ID・差出人が、`SES_REGION`・`MAIL_FROM` と合っていない |
| 迷惑メールに入る | `connect.apgifu.org` を別の ID にして DKIM を設定する（手順 1 の「任意」） |

---

## 運用

- **アクセスキーの交換**: IAM で新しいアクセスキーを作り、手順 3-1 で入れ直して再デプロイしてから、古いキーを無効化・削除する。
- **送信を止めたいとき**: `AWS_SES_ACCESS_KEY_ID` に `unset` を入れて再デプロイすると、送らずにログに出すだけに戻る。
  ```bash
  printf 'unset' | firebase functions:secrets:set AWS_SES_ACCESS_KEY_ID --project default-41833 --data-file -
  ```
- **送信の状況**: AWS コンソール > Amazon SES > アカウントダッシュボードで、送信数・バウンス率・苦情率を確認できる。バウンス率・苦情率が高いと、SES の送信が止められることがある。
- 差出人のアドレス（`noreply@`）には返信を受け付ける受信箱を用意しない。会員からの問い合わせ先は、別に案内する。

---

## 関連

- メールを送る処理: [`functions/src/mail.ts`](functions/src/mail.ts)
- デプロイ全体の手順: [`DEPLOY.md`](DEPLOY.md)
- サービスのドメイン（`connect.apgifu.org`）の設定: [`DEPLOY.md` の「独自ドメインへの切り替え」](DEPLOY.md#独自ドメインへの切り替え)
