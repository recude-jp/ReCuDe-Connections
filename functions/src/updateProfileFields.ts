import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { requireScopeAdmin } from './adminScope';
import { recomputeCommunityDerivedValues, recomputeDerivedValues, sanitizeProfileFields } from './profile';

/**
 * 管理者がプロフィール項目を設定する(一覧をまるごと置き換える。並び順も一覧の順)。
 * 対象(scope)がルートコミュニティならテナントの項目、連携コミュニティならその連携コミュニティ独自の項目。
 * 項目を消しても、会員が入力済みの値は消さない(表示しなくなるだけ)。項目IDは一度決めたら変えない前提。
 */
export const updateProfileFields = onCall(async (request) => {
  const data = request.data ?? {};
  const { identity, communityId, communityRef } = await requireScopeAdmin(request.auth, data.scope);
  if (communityRef && communityId) {
    const fields = sanitizeProfileFields(data.fields, { allowPrivate: false });
    await communityRef.update({ profileFields: fields });
    const recomputed = await recomputeCommunityDerivedValues(identity.tenantId, communityId, fields);
    return { fields, recomputed };
  }
  const fields = sanitizeProfileFields(data.fields);
  await admin.firestore().doc(`tenants/${identity.tenantId}`).update({ profileFields: fields });
  // 自動計算の項目を追加・変更したときに、すぐ全員分に反映する。
  const recomputed = await recomputeDerivedValues(identity.tenantId);
  return { fields, recomputed };
});
