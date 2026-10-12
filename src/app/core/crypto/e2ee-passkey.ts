/**
 * パスキーの PRF 拡張(WebAuthn)で、暗号鍵を守る秘密の値を取り出す(SECURITY-DEVELOPMENT.md 6-3)。
 * ログインとは別の、端末の中だけで完結する操作(サーバーには何も送らないため、チャレンジは端末で作った乱数でよい)。
 * PRF は同じパスキー・同じ入力なら同じ値を返すので、その値から作った鍵で秘密鍵の控えを暗号化・復号する。
 */

/** パスキーの PRF を使えない(端末・ブラウザが対応していない、またはパスキーが PRF に対応していない)。 */
export class PrfUnavailableError extends Error {
  constructor() {
    super('この端末・ブラウザのパスキーでは、暗号鍵を守れません。回復コードをお使いください。');
    this.name = 'PrfUnavailableError';
  }
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

interface ClientCapabilitiesApi {
  getClientCapabilities?: () => Promise<Record<string, boolean>>;
}

/**
 * パスキーの PRF を使えそうか。ブラウザが対応状況を答えられないときは、使えるものとして扱う
 * (実際に使えなかったときは PrfUnavailableError になる)。
 */
export async function isPrfLikelySupported(): Promise<boolean> {
  if (typeof PublicKeyCredential === 'undefined') {
    return false;
  }
  const api = PublicKeyCredential as unknown as ClientCapabilitiesApi;
  if (!api.getClientCapabilities) {
    return true;
  }
  try {
    const capabilities = await api.getClientCapabilities();
    return capabilities['extension:prf'] !== false;
  } catch {
    return true;
  }
}

/**
 * パスキーで認証して、PRF の値を取り出す。credentialIds を渡すと、その中のパスキーだけを候補にする
 * (空なら、この端末にある、このサイトのパスキーから選んでもらう)。
 * 使ったパスキーの credentialId(base64url)と、PRF の値を返す。
 */
export async function evaluatePrf(
  salt: Uint8Array<ArrayBuffer>,
  credentialIds: string[] = [],
): Promise<{ credentialId: string; output: ArrayBuffer }> {
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: location.hostname,
      allowCredentials: credentialIds.map((id) => ({ type: 'public-key' as const, id: base64UrlToBytes(id) })),
      userVerification: 'required',
      timeout: 120_000,
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!credential) {
    throw new PrfUnavailableError();
  }
  const results = credential.getClientExtensionResults() as { prf?: { results?: { first?: BufferSource } } };
  const first = results.prf?.results?.first;
  if (!first) {
    throw new PrfUnavailableError();
  }
  const view = first instanceof ArrayBuffer ? new Uint8Array(first) : new Uint8Array((first as ArrayBufferView).buffer, (first as ArrayBufferView).byteOffset, (first as ArrayBufferView).byteLength);
  const output = view.slice().buffer;
  return { credentialId: credential.id, output };
}
