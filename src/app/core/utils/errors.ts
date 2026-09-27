/** Firebase/Cloud FunctionsのHttpsErrorも含め、UIに表示できるメッセージ文字列に変換する。 */
export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return '処理に失敗しました。時間をおいて再度お試しください。';
}

/**
 * WebAuthn(パスキー)操作のエラーをUIに表示できるメッセージ文字列に変換する。
 * ユーザーが認証器のダイアログをキャンセルした場合もタイムアウトした場合も、ブラウザは
 * 区別なく `NotAllowedError`(英語の技術的な文言)を投げてくるため、専用の分かりやすい
 * メッセージに差し替える(@simplewebauthn/browserがラップした場合もcause元のnameを引き継ぐ)。
 */
export function toPasskeyErrorMessage(err: unknown): string {
  if (err instanceof Error && err.name === 'NotAllowedError') {
    return 'パスキーの操作がキャンセルされたか、時間内に完了しませんでした。もう一度お試しください。';
  }
  return toErrorMessage(err);
}

const PHONE_AUTH_ERROR_MESSAGES: Record<string, string> = {
  // Firebaseプロジェクトの「SMSリージョンポリシー」等の設定により送信できない場合。
  // 開発者向けの英語メッセージ(auth/operation-not-allowed)をそのまま出さないようにする。
  'auth/operation-not-allowed':
    '現在、SMSによる認証コードの送信を利用できません。時間をおいて再度お試しいただくか、事務局までお問い合わせください。',
  'auth/invalid-phone-number': '電話番号の形式が正しくありません。ハイフンなしの数字でご入力ください。',
  'auth/missing-phone-number': '電話番号を入力してください。',
  'auth/quota-exceeded': 'SMSの送信件数が上限に達しています。時間をおいて再度お試しください。',
  'auth/too-many-requests': 'リクエストが多すぎます。時間をおいて再度お試しください。',
  'auth/captcha-check-failed': '確認に失敗しました。ページを再読み込みしてもう一度お試しください。',
  'auth/invalid-verification-code': '認証コードが正しくありません。ご確認のうえ再度入力してください。',
  'auth/code-expired': '認証コードの有効期限が切れました。もう一度SMSを送信してください。',
  'auth/network-request-failed': '通信に失敗しました。電波状況をご確認のうえ、再度お試しください。',
};

/** 電話番号OTP送信・確認(signInWithPhoneNumber等)のFirebaseエラーを日本語メッセージに変換する。 */
export function toPhoneAuthErrorMessage(err: unknown): string {
  const code = err instanceof Error ? (err as unknown as { code?: unknown }).code : undefined;
  if (typeof code === 'string' && code in PHONE_AUTH_ERROR_MESSAGES) {
    return PHONE_AUTH_ERROR_MESSAGES[code];
  }
  return toErrorMessage(err);
}
