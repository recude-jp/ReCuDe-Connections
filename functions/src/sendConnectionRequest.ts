import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { isFullMember } from './communities';
import type { Connection, Member } from './models';

/** 2人のmemberIdから、順序に依存しない固定のコネクションIDを作る。 */
function connectionIdFor(memberIdA: string, memberIdB: string): string {
  return [memberIdA, memberIdB].sort().join('_');
}

/**
 * 会員が他の会員にコネクト申請を送る。1組につき有効な申請/成立は1件までとし、
 * 却下済みの場合は再申請を許可する(招待の重複防止ポリシーと同じ考え方)。
 */
export const sendConnectionRequest = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'ログインが必要です。');
  }

  const tenantId = request.auth.token['tenantId'] as string | undefined;
  const memberId = request.auth.token['memberId'] as string | undefined;
  if (!tenantId || !memberId) {
    throw new HttpsError('permission-denied', '会員のみ操作できます。');
  }

  const { toMemberId } = (request.data ?? {}) as { toMemberId?: string };
  if (!toMemberId || typeof toMemberId !== 'string') {
    throw new HttpsError('invalid-argument', '申請先の会員を指定してください。');
  }
  if (toMemberId === memberId) {
    throw new HttpsError('invalid-argument', '自分自身には申請できません。');
  }
  // ゲスト(まだ正規の会員でない人)は、出会いを探すで会員を見られるが、コネクト申請はできない。
  if (request.auth.token['isGuest'] === true) {
    throw new HttpsError('permission-denied', 'コネクト申請は、正規の会員になるとできるようになります。');
  }

  const db = admin.firestore();
  const targetSnap = await db.doc(`tenants/${tenantId}/members/${toMemberId}`).get();
  const target = targetSnap.data() as Member | undefined;
  if (!target || !target.isActive || !isFullMember(target)) {
    throw new HttpsError('not-found', '申請先の会員が見つかりません。');
  }

  const connectionId = connectionIdFor(memberId, toMemberId);
  const connectionRef = db.doc(`tenants/${tenantId}/connections/${connectionId}`);
  const existingSnap = await connectionRef.get();
  const existing = existingSnap.data() as Connection | undefined;

  if (existing && (existing.status === 'pending' || existing.status === 'accepted')) {
    throw new HttpsError('already-exists', 'すでに申請済み、またはつながっています。');
  }

  const connection: Connection = {
    memberIds: [memberId, toMemberId].sort(),
    requestedBy: memberId,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
  };

  await connectionRef.set(connection);

  return { connectionId };
});
