/**
 * エンドツーエンド暗号化の暗号処理(WebCrypto だけを使う。Firebase には依存しない)。
 * 設計は SECURITY-DEVELOPMENT.md 6章。
 *
 * - 会員の鍵ペア: ECDH P-256。秘密鍵は端末に「取り出せない CryptoKey」として置く。秘密鍵の控え(バックアップ)は、
 *   パスキーの PRF(端末の生体認証で取り出せる秘密の値)と、回復コードの2通りで暗号化して持つ。
 * - ルームの鍵: AES-GCM 256bit。受け取る人ごとに、その場で作る鍵ペアと受け取る人の公開鍵から ECDH → HKDF で鍵を作って包む。
 * - メッセージ・画像: ルームの鍵で AES-GCM。追加認証データ(AAD)で、暗号文を別のメッセージ・ルームに移せないようにする。
 */

/** 暗号文の形式の版(変えたときに古いものと区別する)。 */
export const E2EE_VERSION = 1;

/** 回復コードから鍵を作るときの PBKDF2 の繰り返し回数(OWASP の推奨値に合わせる)。 */
export const PBKDF2_ITERATIONS = 600_000;

const ECDH: EcKeyGenParams = { name: 'ECDH', namedCurve: 'P-256' };
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---- 文字列との変換 ----

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** 鍵のID(鍵を作り直したことを見分けるための、推測されない文字列)。 */
export function newKeyId(): string {
  return toBase64(randomBytes(12)).replace(/[+/=]/g, '');
}

// ---- 会員の鍵ペア ----

export interface GeneratedMemberKeys {
  keyId: string;
  /** 端末に保存する、取り出せない秘密鍵。 */
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwk: JsonWebKey;
  /** バックアップを作るための秘密鍵(JWK)。バックアップを作ったら捨てる。 */
  privateJwk: JsonWebKey;
}

/** 会員の鍵ペアを作る。秘密鍵は、バックアップ用に一度だけ JWK で取り出し、端末には取り出せない形で置き直す。 */
export async function generateMemberKeys(): Promise<GeneratedMemberKeys> {
  const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
  const [publicJwk, privateJwk] = await Promise.all([
    crypto.subtle.exportKey('jwk', pair.publicKey),
    crypto.subtle.exportKey('jwk', pair.privateKey),
  ]);
  return {
    keyId: newKeyId(),
    privateKey: await importPrivateKey(privateJwk),
    publicKey: pair.publicKey,
    publicJwk,
    privateJwk,
  };
}

/** 秘密鍵(JWK)を、取り出せない CryptoKey にする。 */
export function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, ECDH, false, ['deriveBits']);
}

export function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, ECDH, true, []);
}

// ---- 回復コード ----

/** 回復コードに使う文字(Crockford の Base32。読み間違えやすい I・L・O・U を使わない)。 */
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * 回復コード(120bit のランダムな値。4文字ずつハイフンで区切った24文字。例: 7K3Q-…)。
 * 端末をすべて失ったときや、パスキーが引き継がれない機種に変えたときに、暗号鍵を戻すのに使う。
 */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(15);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += RECOVERY_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{4}/g)!.join('-');
}

/** 入力された回復コードを、比べられる形にする(小文字・空白・ハイフン、読み間違えやすい文字を直す)。 */
export function normalizeRecoveryCode(input: string): string {
  const cleaned = input
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return cleaned.match(/.{1,4}/g)?.join('-') ?? '';
}

// ---- 秘密の値(回復コード)によるバックアップ ----

export interface KeyBackup {
  v: number;
  keyId: string;
  salt: string;
  iterations: number;
  iv: string;
  /** 秘密鍵(JWK)を暗号化したもの。 */
  ct: string;
}

async function deriveBackupKey(secret: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret.normalize('NFKC')), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** 秘密鍵(JWK)を秘密の値(回復コード)で暗号化する。 */
export async function encryptKeyBackup(keyId: string, privateJwk: JsonWebKey, secret: string): Promise<KeyBackup> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveBackupKey(secret, salt, PBKDF2_ITERATIONS);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(`backup/${keyId}`) },
    key,
    encoder.encode(JSON.stringify(privateJwk)),
  );
  return { v: E2EE_VERSION, keyId, salt: toBase64(salt), iterations: PBKDF2_ITERATIONS, iv: toBase64(iv), ct: toBase64(ct) };
}

/** バックアップを秘密の値(回復コード)で復号し、秘密鍵(JWK)を返す。違うときは例外(WrongSecretError)。 */
export async function decryptKeyBackup(backup: KeyBackup, secret: string): Promise<JsonWebKey> {
  const key = await deriveBackupKey(secret, fromBase64(backup.salt), backup.iterations);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(backup.iv), additionalData: encoder.encode(`backup/${backup.keyId}`) },
      key,
      fromBase64(backup.ct),
    );
    return JSON.parse(decoder.decode(plain)) as JsonWebKey;
  } catch {
    throw new WrongSecretError();
  }
}

export class WrongSecretError extends Error {
  constructor() {
    super('回復コードが正しくありません。');
    this.name = 'WrongSecretError';
  }
}

// ---- パスキー(PRF)によるバックアップ ----

/** パスキーで守った秘密鍵の控え。 */
export interface PasskeyKeyWrap {
  v: number;
  keyId: string;
  /** 守ったパスキーの credentialId(base64url)。 */
  credentialId: string;
  iv: string;
  ct: string;
}

/**
 * パスキーの PRF に渡す入力(会員ごとに決まった値。保存しない)。PRF は、同じパスキー・同じ入力なら同じ値を返す。
 */
export async function prfSaltFor(tenantId: string, memberId: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`recude-e2ee-prf/${tenantId}/${memberId}`)));
}

async function deriveKeyFromPrf(prfOutput: ArrayBuffer, keyId: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: encoder.encode(`passkey-wrap/${keyId}`) },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** 秘密鍵(JWK)を、パスキーの PRF の値で暗号化する。 */
export async function wrapKeyWithPrf(
  keyId: string,
  credentialId: string,
  privateJwk: JsonWebKey,
  prfOutput: ArrayBuffer,
): Promise<PasskeyKeyWrap> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(`passkey/${keyId}/${credentialId}`) },
    await deriveKeyFromPrf(prfOutput, keyId),
    encoder.encode(JSON.stringify(privateJwk)),
  );
  return { v: E2EE_VERSION, keyId, credentialId, iv: toBase64(iv), ct: toBase64(ct) };
}

export async function unwrapKeyWithPrf(wrap: PasskeyKeyWrap, prfOutput: ArrayBuffer): Promise<JsonWebKey> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(wrap.iv), additionalData: encoder.encode(`passkey/${wrap.keyId}/${wrap.credentialId}`) },
    await deriveKeyFromPrf(prfOutput, wrap.keyId),
    fromBase64(wrap.ct),
  );
  return JSON.parse(decoder.decode(plain)) as JsonWebKey;
}

// ---- ルームの鍵 ----

/** 受け取る人の公開鍵で包んだルームの鍵。 */
export interface WrappedRoomKey {
  /** その場で作った鍵ペアの公開鍵。 */
  epk: JsonWebKey;
  iv: string;
  ct: string;
  /** 受け取る人の鍵のID(鍵を作り直した人には、包み直す)。 */
  keyId: string;
}

export function generateRoomKey(): Promise<CryptoKey> {
  // 新しく加わったメンバーに包み直して渡すため、取り出せる鍵にする(端末の外には、包んだ形でしか出さない)。
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** ECDH の共有の値から、ルームの鍵を包む AES-GCM の鍵を作る(info に用途と宛先を入れる)。 */
async function deriveWrappingKey(privateKey: CryptoKey, publicKey: CryptoKey, info: string): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const hkdfKey = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: encoder.encode(info) },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** ルームの鍵を、受け取る人の公開鍵で包む。context には「テナント/ルーム/世代/受け取る人」を入れる。 */
export async function wrapRoomKey(
  roomKey: CryptoKey,
  recipientPublicJwk: JsonWebKey,
  recipientKeyId: string,
  context: string,
): Promise<WrappedRoomKey> {
  const ephemeral = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
  const wrappingKey = await deriveWrappingKey(ephemeral.privateKey, await importPublicKey(recipientPublicJwk), `room-key/${context}`);
  const iv = randomBytes(12);
  const raw = await crypto.subtle.exportKey('raw', roomKey);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) }, wrappingKey, raw);
  return {
    epk: await crypto.subtle.exportKey('jwk', ephemeral.publicKey),
    iv: toBase64(iv),
    ct: toBase64(ct),
    keyId: recipientKeyId,
  };
}

/** 自分あてに包まれたルームの鍵を、自分の秘密鍵で取り出す。 */
export async function unwrapRoomKey(wrapped: WrappedRoomKey, privateKey: CryptoKey, context: string): Promise<CryptoKey> {
  const wrappingKey = await deriveWrappingKey(privateKey, await importPublicKey(wrapped.epk), `room-key/${context}`);
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(wrapped.iv), additionalData: encoder.encode(context) },
    wrappingKey,
    fromBase64(wrapped.ct),
  );
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

// ---- メッセージ・ファイル ----

/** メッセージの暗号文(メッセージのドキュメントの enc)。 */
export interface EncryptedPayload {
  v: number;
  /** ルームの鍵の世代。 */
  epoch: number;
  iv: string;
  ct: string;
}

export async function encryptJson(roomKey: CryptoKey, epoch: number, value: unknown, aad: string): Promise<EncryptedPayload> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(aad) },
    roomKey,
    encoder.encode(JSON.stringify(value)),
  );
  return { v: E2EE_VERSION, epoch, iv: toBase64(iv), ct: toBase64(ct) };
}

export async function decryptJson<T>(roomKey: CryptoKey, payload: EncryptedPayload, aad: string): Promise<T> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(payload.iv), additionalData: encoder.encode(aad) },
    roomKey,
    fromBase64(payload.ct),
  );
  return JSON.parse(decoder.decode(plain)) as T;
}

/** ファイル(画像)を暗号化する。iv は暗号文の先頭12バイトに付ける。 */
export async function encryptBytes(roomKey: CryptoKey, data: ArrayBuffer, aad: string): Promise<Blob> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(aad) }, roomKey, data);
  return new Blob([iv, ct], { type: 'application/octet-stream' });
}

export async function decryptBytes(roomKey: CryptoKey, data: ArrayBuffer, aad: string): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(data);
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: encoder.encode(aad) },
    roomKey,
    bytes.slice(12),
  );
}
