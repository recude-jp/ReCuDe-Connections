import { randomBytes, scrypt, timingSafeEqual } from 'crypto';

const SALT_BYTES = 16;
const KEY_LENGTH = 64;
/** scryptのコストパラメータ。Node標準デフォルト(N=16384, r=8, p=1)。 */
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function scryptAsync(secret: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, keylen, SCRYPT_OPTIONS, (err, derivedKey) => {
      if (err) {
        reject(err);
      } else {
        resolve(derivedKey);
      }
    });
  });
}

/** 秘密値(PIN等)をランダムsalt付きscryptでハッシュ化し、"saltHex:hashHex"形式の文字列で返す。生値は保存しない。 */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(secret, salt, KEY_LENGTH);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

/** hashSecretで保存した値との一致をタイミング攻撃耐性のある比較で検証する。 */
export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) {
    return false;
  }
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = await scryptAsync(secret, salt, KEY_LENGTH);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
