const FALLBACK_MESSAGE = '処理に失敗しました。時間をおいて再度お試しください。';

/**
 * 通信の失敗などで、Cloud Functions が日本語の理由を返さなかったときの文言
 * (このとき、メッセージはコード名や英語のまま届く)。
 */
const FUNCTIONS_ERROR_MESSAGES: Record<string, string> = {
  'functions/unavailable': '通信に失敗しました。電波の状況を確かめて、もう一度お試しください。',
  'functions/deadline-exceeded': '通信に時間がかかっています。電波の状況を確かめて、もう一度お試しください。',
  'functions/internal': FALLBACK_MESSAGE,
  'functions/unknown': FALLBACK_MESSAGE,
};

/** Firebase/Cloud FunctionsのHttpsErrorも含め、UIに表示できるメッセージ文字列に変換する。 */
export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    // サーバーが日本語の理由を付けて返したエラーは、そのまま出す。
    if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(err.message)) {
      return err.message;
    }
    if (typeof code === 'string' && code in FUNCTIONS_ERROR_MESSAGES) {
      return FUNCTIONS_ERROR_MESSAGES[code];
    }
    return err.message || FALLBACK_MESSAGE;
  }
  return FALLBACK_MESSAGE;
}

/**
 * WebAuthn(パスキー)操作のエラーをUIに表示できるメッセージ文字列に変換する。
 * ユーザーが認証器のダイアログをキャンセルした場合もタイムアウトした場合も、ブラウザは
 * 区別なく `NotAllowedError`(英語の技術的な文言)を投げてくるため、専用の分かりやすい
 * メッセージに差し替える(@simplewebauthn/browserがラップした場合もcause元のnameを引き継ぐ)。
 */
export function toPasskeyErrorMessage(err: unknown): string {
  if (isAlreadyRegisteredError(err)) {
    return 'この端末には、すでにこのアカウントのパスキーがあります。';
  }
  if (err instanceof Error && err.name === 'NotAllowedError') {
    return 'パスキーの操作がキャンセルされたか、時間内に完了しませんでした。もう一度お試しください。';
  }
  return toErrorMessage(err);
}

/**
 * 同じ認証器に、同じアカウントのパスキーを重ねて登録しようとした(この端末にはすでにある)。
 * iCloudキーチェーン・Googleパスワードマネージャーで、別の端末で登録したパスキーが同期されていることもある。
 */
export function isAlreadyRegisteredError(err: unknown): boolean {
  const e = err as { name?: string; code?: string; cause?: { name?: string } } | null;
  return (
    e?.name === 'InvalidStateError' ||
    e?.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' ||
    e?.cause?.name === 'InvalidStateError'
  );
}
