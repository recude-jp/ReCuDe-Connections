import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { requireAdmin, requireCallerIdentity } from './callerIdentity';
import { syncMemberClaims } from './memberClaims';
import { getPrivateValues, getProfileFields, sanitizeProfileValues, upsertProfileOptions, writePrivateValues } from './profile';
import { isFullMember, recountCommunities } from './communities';
import type { Member, MembershipApplication, Tenant } from './models';

/**
 * 正規の会員への申請と審査(SPEC 1章「方針の変更」)。
 * ゲストがマイページの「会員登録」から、テナントのプロフィール項目を入力し、会員条件に同意して申請する。
 * 審査はすべて管理者(事務局)が行う(会費の確認なども事務局が行う)。
 */

/** ゲストが正規の会員を申請する(否認されたあとの再申請も同じ)。 */
export const applyForMembership = onCall(async (request) => {
  const identity = requireCallerIdentity(request.auth);
  const { profile: input, agreedToTerms } = (request.data ?? {}) as { profile?: unknown; agreedToTerms?: unknown };

  const db = admin.firestore();
  const memberRef = db.doc(`tenants/${identity.tenantId}/members/${identity.memberId}`);
  const [memberSnap, tenantSnap, fields] = await Promise.all([
    memberRef.get(),
    db.doc(`tenants/${identity.tenantId}`).get(),
    getProfileFields(identity.tenantId),
  ]);
  const member = memberSnap.data() as Member | undefined;
  if (!member || !member.isActive) {
    throw new HttpsError('permission-denied', 'このアカウントは現在無効になっています。');
  }
  // 連携コミュニティだけのメンバーも、ゲストと同じく申請できる(承認されると、連携コミュニティの所属はそのまま正規の会員になる)。
  if (isFullMember(member)) {
    throw new HttpsError('failed-precondition', 'すでに正規の会員です。');
  }
  if (member.membershipApplication?.status === 'pending') {
    throw new HttpsError('failed-precondition', 'すでに申請しています。審査の結果をお待ちください。');
  }

  const { publicValues, privateValues } = sanitizeProfileValues(fields, input, {
    publicValues: member.profile ?? {},
    privateValues: await getPrivateValues(identity.tenantId, identity.memberId),
  });
  const terms = (tenantSnap.data() as Tenant | undefined)?.membershipTerms;
  if (terms?.requireAgreement && agreedToTerms !== true) {
    throw new HttpsError('failed-precondition', '会員の条件を確認し、同意してから申請してください。');
  }

  const application: MembershipApplication = {
    status: 'pending',
    submittedAt: FieldValue.serverTimestamp(),
    ...(terms?.requireAgreement
      ? { termsAgreement: { agreedAt: FieldValue.serverTimestamp(), termsUpdatedAt: terms.updatedAt ?? null } }
      : {}),
  };
  // 非公開の値(生年月など)は会員データとは別に保存する。
  const batch = db.batch();
  batch.update(memberRef, { profile: publicValues, membershipApplication: application });
  writePrivateValues(batch, identity.tenantId, identity.memberId, privateValues);
  await batch.commit();
  await upsertProfileOptions(identity.tenantId, fields, publicValues);
  return { status: 'pending' };
});

/** 管理者がゲストの会員申請を承認・否認する。承認すると正規の会員になる(カスタムクレームも更新する)。 */
export const decideMembership = onCall(async (request) => {
  const { identity } = await requireAdmin(request.auth);
  const { memberId, approve, reason } = (request.data ?? {}) as { memberId?: unknown; approve?: unknown; reason?: unknown };
  if (typeof memberId !== 'string' || !memberId || typeof approve !== 'boolean') {
    throw new HttpsError('invalid-argument', 'パラメータが不正です。');
  }
  const rejectReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';

  const db = admin.firestore();
  const memberRef = db.doc(`tenants/${identity.tenantId}/members/${memberId}`);
  const updated = await db.runTransaction(async (tx) => {
    const member = (await tx.get(memberRef)).data() as Member | undefined;
    if (!member) {
      throw new HttpsError('not-found', '会員が見つかりません。');
    }
    if (isFullMember(member) || member.membershipApplication?.status !== 'pending') {
      throw new HttpsError('failed-precondition', '審査待ちの申請がありません。');
    }
    const application: MembershipApplication = {
      ...member.membershipApplication,
      status: approve ? 'approved' : 'rejected',
      decidedAt: FieldValue.serverTimestamp(),
      decidedBy: identity.memberId,
      ...(approve || !rejectReason ? {} : { rejectReason }),
    };
    const next: Member = { ...member, membershipApplication: application, ...(approve ? { membership: 'member' } : {}) };
    tx.update(memberRef, {
      membershipApplication: application,
      ...(approve ? { membership: 'member' } : {}),
    });
    return next;
  });

  if (approve) {
    await syncMemberClaims(identity.tenantId, memberId, updated);
    // 連携コミュニティの「ルートコミュニティの会員でもある」人数が変わる。
    await recountCommunities(identity.tenantId, updated.communityIds);
  }
  return { status: approve ? 'approved' : 'rejected' };
});
