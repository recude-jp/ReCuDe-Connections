import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { requireAdmin } from './callerIdentity';
import { syncMemberClaims } from './memberClaims';
import { recountCommunities } from './communities';
import type { Member } from './models';

/**
 * 管理者が会員のアカウントを停止/再開する。
 * 停止した会員は発行済みのトークンを無効にし、次回以降のログイン(電話番号・パスキー・PIN)も拒否される。
 * 自分自身と、最後の1人の有効な管理者は停止できない。
 */
export const setMemberStatus = onCall(async (request) => {
  const { identity } = await requireAdmin(request.auth);

  const { memberId, active } = (request.data ?? {}) as { memberId?: string; active?: boolean };
  if (!memberId || typeof active !== 'boolean') {
    throw new HttpsError('invalid-argument', 'リクエストが不正です。');
  }
  if (!active && memberId === identity.memberId) {
    throw new HttpsError('failed-precondition', '自分自身のアカウントは停止できません。');
  }

  const db = admin.firestore();
  const membersRef = db.collection(`tenants/${identity.tenantId}/members`);
  const memberRef = membersRef.doc(memberId);

  const updated = await db.runTransaction(async (tx) => {
    const snap = await tx.get(memberRef);
    const member = snap.data() as Member | undefined;
    if (!member) {
      throw new HttpsError('not-found', '会員が見つかりません。');
    }

    if (!active && member.roles?.admin === true && member.isActive) {
      const adminsSnap = await tx.get(
        membersRef.where('roles.admin', '==', true).where('isActive', '==', true),
      );
      if (adminsSnap.docs.every((doc) => doc.id === memberId)) {
        throw new HttpsError('failed-precondition', '最後の1人の管理者は停止できません。');
      }
    }

    tx.update(memberRef, { isActive: active });
    return { ...member, isActive: active };
  });

  await syncMemberClaims(identity.tenantId, memberId, updated, { revokeTokens: !active });
  // 連携コミュニティの参加者数は、有効な会員だけを数える。
  await recountCommunities(identity.tenantId, updated.communityIds);

  return { isActive: updated.isActive };
});
