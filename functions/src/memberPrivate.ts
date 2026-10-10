import * as admin from 'firebase-admin';
import type { MemberRef } from './callerIdentity';
import type { Member, MemberLoginSettings } from './models';

/**
 * 会員の本人と管理者だけが読める情報(members/[memberId]/private/...)の読み書き。
 * 会員データ(members)は同じテナントの会員が読めるため、電話番号などはここに置く(SECURITY-DEVELOPMENT.md 7章)。
 */

export function loginSettingsPath(ref: MemberRef): string {
  return `tenants/${ref.tenantId}/members/${ref.memberId}/private/login`;
}

/**
 * 会員の電話番号。private/login に置く(移行前のデータは会員データの phoneNumber にある)。
 * settings を渡すと、読み直さない。
 */
export async function getMemberPhone(
  ref: MemberRef,
  member?: Pick<Member, 'phoneNumber'>,
  settings?: Partial<MemberLoginSettings>,
): Promise<string | undefined> {
  const loaded =
    settings ??
    ((await admin.firestore().doc(loginSettingsPath(ref)).get()).data() as Partial<MemberLoginSettings> | undefined);
  return loaded?.phoneNumber ?? member?.phoneNumber;
}
