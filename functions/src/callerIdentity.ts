import { HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import type { Member } from './models';

type AuthData = CallableRequest['auth'];

/** テナント内の会員を指す参照。パスキー・PINの保存先パスの解決などに使う。 */
export interface MemberRef {
  tenantId: string;
  memberId: string;
}

export interface CallerIdentity extends MemberRef {
  kind: 'member';
  uid: string;
}

/**
 * onCallの request.auth から会員のidentityを解決する(カスタムクレームベースの認可判定)。
 * 管理者も「会員＋管理者ロール」のため、同じくここで解決する。
 * 旧方式の事務局アカウント(メール＋パスワード、role: 'admin' クレーム)は受け付けない。
 */
export function requireCallerIdentity(auth: AuthData): CallerIdentity {
  if (!auth) {
    throw new HttpsError('unauthenticated', 'ログインが必要です。');
  }

  const tenantId = auth.token['tenantId'] as string | undefined;
  const memberId = auth.token['memberId'] as string | undefined;
  if (tenantId && memberId) {
    return { kind: 'member', tenantId, uid: auth.uid, memberId };
  }

  throw new HttpsError('permission-denied', 'ログイン状態を確認できません。');
}

/** ゲストかどうか(カスタムクレームで判定する。正規の会員になるとクレームも更新される)。 */
export function isGuestCaller(auth: AuthData): boolean {
  return auth?.token['isGuest'] === true;
}

/**
 * 正規の会員(ゲストでない)からの呼び出しであることを確認する。
 * ゲストはトーク・出会いを探す・イベントの参照だけができ、招待・グループ・コネクト申請はできない。
 */
export function requireFullMember(auth: AuthData, action = 'この操作'): CallerIdentity {
  const identity = requireCallerIdentity(auth);
  if (isGuestCaller(auth)) {
    throw new HttpsError('permission-denied', `${action}は、正規の会員になるとできるようになります。`);
  }
  return identity;
}

export interface AdminCaller {
  identity: CallerIdentity;
  member: Member;
}

/**
 * 管理者ロールを持つ有効な会員からの呼び出しであることを確認する。
 * カスタムクレーム(isAdmin)は剥奪後もIDトークンの有効期限まで残るため、
 * 会員ドキュメントの roles.admin・isActive も必ず確認する。
 */
export async function requireAdmin(auth: AuthData): Promise<AdminCaller> {
  const identity = requireCallerIdentity(auth);
  if (auth?.token['isAdmin'] !== true) {
    throw new HttpsError('permission-denied', '管理者のみ操作できます。');
  }

  const snap = await admin.firestore().doc(`tenants/${identity.tenantId}/members/${identity.memberId}`).get();
  const member = snap.data() as Member | undefined;
  if (!member || !member.isActive || member.roles?.admin !== true) {
    throw new HttpsError('permission-denied', '管理者のみ操作できます。');
  }
  return { identity, member };
}

/**
 * パスキー・PINの逆引きインデックスから会員への参照を取り出す。
 * 旧方式の事務局アカウント(kind: 'admin')の登録は、移行後はログインに使えないため null を返す。
 */
export function memberRefFromIndex(entry: {
  tenantId: string;
  kind: 'member' | 'admin';
  memberId?: string;
}): MemberRef | null {
  return entry.kind === 'member' && entry.memberId
    ? { tenantId: entry.tenantId, memberId: entry.memberId }
    : null;
}
