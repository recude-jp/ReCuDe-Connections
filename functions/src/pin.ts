import type { MemberRef } from './callerIdentity';

/** PINは6桁固定の数字のみ。 */
export const PIN_REGEX = /^\d{6}$/;

/** この回数連続で失敗するとロックアウトする。 */
export const PIN_MAX_ATTEMPTS = 5;

/** ロックアウトの継続時間(ミリ秒)。 */
export const PIN_LOCKOUT_MS = 15 * 60 * 1000;

/** 会員のPINログイン用端末を保存するFirestoreのサブコレクションパスを返す。 */
export function pinDevicesCollectionPath(member: MemberRef): string {
  return `tenants/${member.tenantId}/members/${member.memberId}/pinDevices`;
}
