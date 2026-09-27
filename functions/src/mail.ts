import * as logger from 'firebase-functions/logger';

/**
 * メールを送信する。メール配信サービスは未設定のため、今は本文をログに出力するだけに留める
 * (招待SMSと同じ扱い。本番で送るときは、ここに SendGrid などの送信処理を入れる)。
 */
export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  logger.info(`[メール未送信: 配信サービス未設定のためログ出力のみ] to=${to}\n件名: ${subject}\n${body}`);
}
