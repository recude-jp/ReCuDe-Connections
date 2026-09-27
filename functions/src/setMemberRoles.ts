import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { requireAdmin } from './callerIdentity';
import { syncMemberClaims } from './memberClaims';
import { isFullMember } from './communities';
import type { Member } from './models';

/**
 * 管理者が会員のロール(認定推薦者・管理者)を付与/剥奪する。
 * 最後の1人の有効な管理者から管理者ロールは外せない(テナントを管理できる人がいなくなるため)。
 */
export const setMemberRoles = onCall(async (request) => {
  const { identity } = await requireAdmin(request.auth);

  const { memberId, recommender, admin: isAdmin } = (request.data ?? {}) as {
    memberId?: string;
    recommender?: boolean;
    admin?: boolean;
  };
  if (!memberId || (typeof recommender !== 'boolean' && typeof isAdmin !== 'boolean')) {
    throw new HttpsError('invalid-argument', 'リクエストが不正です。');
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
    if (!isFullMember(member) && (recommender === true || isAdmin === true)) {
      throw new HttpsError('failed-precondition', 'ゲストにはロールを付けられません。先に会員申請を承認してください。');
    }

    if (isAdmin === false && member.roles?.admin === true) {
      const adminsSnap = await tx.get(
        membersRef.where('roles.admin', '==', true).where('isActive', '==', true),
      );
      const otherAdmins = adminsSnap.docs.filter((doc) => doc.id !== memberId);
      if (otherAdmins.length === 0) {
        throw new HttpsError('failed-precondition', '最後の1人の管理者からは管理者ロールを外せません。');
      }
    }

    const roles = {
      ...member.roles,
      ...(typeof recommender === 'boolean' ? { recommender } : {}),
      ...(typeof isAdmin === 'boolean' ? { admin: isAdmin } : {}),
    };
    tx.update(memberRef, { roles });
    return { ...member, roles };
  });

  await syncMemberClaims(identity.tenantId, memberId, updated);

  return { roles: updated.roles };
});
