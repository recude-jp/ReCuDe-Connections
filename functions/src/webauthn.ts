import { defineString } from 'firebase-functions/params';
import { appBaseUrl } from './twilio';
import type { MemberRef } from './callerIdentity';

/** WebAuthnのRelying Party表示名(認証器のUI等に表示される)。 */
export const webauthnRpName = defineString('WEBAUTHN_RP_NAME', { default: 'ReCuDe Match' });

/** WebAuthnの検証に使うoriginは、招待SMSと同じ単一情報源(APP_BASE_URL)から導出する。 */
export function resolveOrigin(): string {
  return appBaseUrl.value();
}

/** rpIDはoriginのホスト名(ポート番号・スキームを除いた部分)。 */
export function resolveRpID(): string {
  return new URL(appBaseUrl.value()).hostname;
}

/** 会員のパスキーを保存するFirestoreのサブコレクションパスを返す。 */
export function credentialsCollectionPath(member: MemberRef): string {
  return `tenants/${member.tenantId}/members/${member.memberId}/passkeyCredentials`;
}

/** チャレンジの有効期限(ミリ秒)。この時間内にregistration/authenticationを完了させる必要がある。 */
export const CHALLENGE_TTL_MS = 2 * 60 * 1000;
