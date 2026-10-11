import { defineSecret, defineString } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { twilioSecrets } from './twilio';

/**
 * メールの送信(Amazon SES)。ログインの認証コード・メールアドレスの確認・招待のメールに使う。
 * 認証情報は、SES の送信だけを許可した IAM ユーザーのアクセスキー(DEPLOY.md「メール送信を有効にする」)。
 */
const sesAccessKeyId = defineSecret('AWS_SES_ACCESS_KEY_ID');
const sesSecretAccessKey = defineSecret('AWS_SES_SECRET_ACCESS_KEY');

/** 送信元のドメインを SES で確認したリージョン(例: ap-northeast-1)。 */
const sesRegion = defineString('SES_REGION', { default: 'ap-northeast-1' });
/** 差出人(例: `TOKYO GIFU CONNECT <noreply@connect.apgifu.org>`)。SES で確認済みのドメインのアドレスにする。 */
const mailFrom = defineString('MAIL_FROM', { default: '' });

/** onCall 関数の config に渡す secrets 宣言(メールを送る関数で使う)。 */
export const mailSecrets = [sesAccessKeyId, sesSecretAccessKey];

/** SMS とメールの両方を送りうる関数の secrets 宣言。 */
export const messagingSecrets = [...twilioSecrets, ...mailSecrets];

/** 未設定とみなす値か(空文字と、デプロイのために置くプレースホルダー "unset")。twilio.ts と同じ扱い。 */
function isBlank(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' || trimmed.toLowerCase() === 'unset';
}

let client: SESv2Client | null = null;
let clientKey = '';

function sesClient(region: string, accessKeyId: string, secretAccessKey: string): SESv2Client {
  const key = `${region}:${accessKeyId}`;
  if (!client || clientKey !== key) {
    client = new SESv2Client({ region, credentials: { accessKeyId, secretAccessKey } });
    clientKey = key;
  }
  return client;
}

/**
 * メールを送る。SES の認証情報か差出人が未設定(ローカル開発・確認用デプロイなど)の場合は、実際には送らず、
 * 本文をログに出すだけにする(招待SMSと同じ扱い)。
 */
export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const accessKeyId = sesAccessKeyId.value();
  const secretAccessKey = sesSecretAccessKey.value();
  const from = mailFrom.value();

  if (isBlank(accessKeyId) || isBlank(secretAccessKey) || isBlank(from)) {
    logger.info(`[メール未送信: 配信サービス未設定のためログ出力のみ] to=${to}\n件名: ${subject}\n${body}`);
    return;
  }

  await sesClient(sesRegion.value(), accessKeyId, secretAccessKey).send(
    new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Text: { Data: body, Charset: 'UTF-8' } },
        },
      },
    }),
  );
}
