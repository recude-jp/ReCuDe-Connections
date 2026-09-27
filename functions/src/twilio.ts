import { defineSecret, defineString } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import twilio from 'twilio';

const twilioAccountSid = defineSecret('TWILIO_ACCOUNT_SID');
const twilioAuthToken = defineSecret('TWILIO_AUTH_TOKEN');
const twilioFromNumber = defineSecret('TWILIO_FROM_NUMBER');

/** 招待SMSに載せる登録ページのURL。本番デプロイ時に実際のドメインへ差し替える。 */
export const appBaseUrl = defineString('APP_BASE_URL', { default: 'http://localhost:54866' });

/** onCall関数のconfigに渡すsecrets宣言。 */
export const twilioSecrets = [twilioAccountSid, twilioAuthToken, twilioFromNumber];

/**
 * 未設定とみなす値かどうかを判定する。空文字に加え、GCPデプロイスクリプトが
 * Secret Manager上に確保のため置くプレースホルダー"unset"も未設定として扱う
 * (Cloud Functions v2のsecretsはSecret Manager側にシークレット自体が存在しないと
 * デプロイできないため、実SMSを使わない環境でもダミー値の登録が必要になる)。
 */
function isBlank(value: string | undefined): boolean {
  if (!value) {
    return true;
  }
  const trimmed = value.trim();
  return trimmed === '' || trimmed.toLowerCase() === 'unset';
}

/**
 * SMSを送信する。Twilioの認証情報が未設定(ローカル開発・確認用デプロイなど)の場合は
 * 実送信をスキップし、本文をログに出力するだけに留める。
 */
export async function sendSms(to: string, body: string): Promise<void> {
  const accountSid = twilioAccountSid.value();
  const authToken = twilioAuthToken.value();
  const fromNumber = twilioFromNumber.value();

  if (isBlank(accountSid) || isBlank(authToken) || isBlank(fromNumber)) {
    logger.info(`[SMS未送信: Twilio未設定のためログ出力のみ] to=${to}\n${body}`);
    return;
  }

  const client = twilio(accountSid, authToken);
  await client.messages.create({ to, from: fromNumber, body });
}
