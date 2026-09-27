import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { requireCallerIdentity } from './callerIdentity';
import { requireScopeAdmin } from './adminScope';
import { communityPath, communityRemoval, isFullMember, recountCommunities, syncCommunityAdmins } from './communities';
import { syncMemberClaims } from './memberClaims';
import { profileOptionCategory, sanitizeProfileValues, upsertProfileOptions } from './profile';
import type { Community, Member, MembershipApplication } from './models';

/**
 * 連携コミュニティの管理画面(会員一覧・会員詳細・会員申請)と、メンバー本人の連携コミュニティのプロフィール(SPEC 9章)。
 * 管理の操作は、その連携コミュニティの管理者かルートコミュニティの管理者が行う(adminScope.ts)。
 */

const db = () => admin.firestore();

function readTarget(data: unknown): { communityId: string; memberId: string } {
  const { communityId, memberId } = (data ?? {}) as { communityId?: unknown; memberId?: unknown };
  if (typeof communityId !== 'string' || !communityId || typeof memberId !== 'string' || !memberId) {
    throw new HttpsError('invalid-argument', 'パラメータが不正です。');
  }
  return { communityId, memberId };
}

async function loadMember(tenantId: string, memberId: string): Promise<{ ref: FirebaseFirestore.DocumentReference; member: Member }> {
  const ref = db().doc(`tenants/${tenantId}/members/${memberId}`);
  const member = (await ref.get()).data() as Member | undefined;
  if (!member) {
    throw new HttpsError('not-found', '会員が見つかりません。');
  }
  return { ref, member };
}

/**
 * 連携コミュニティの管理者に任命する・外す。管理者はルートコミュニティの有効な正規の会員に限り、0人にはできない。
 * 任命した人は、その連携コミュニティのメンバーにもなる。
 */
export const setCommunityAdmin = onCall(async (request) => {
  const { communityId, memberId } = readTarget(request.data);
  const makeAdmin = (request.data ?? {}).admin;
  if (typeof makeAdmin !== 'boolean') {
    throw new HttpsError('invalid-argument', 'パラメータが不正です。');
  }
  const { identity, community, communityRef } = await requireScopeAdmin(request.auth, { type: 'community', communityId });
  const { member } = await loadMember(identity.tenantId, memberId);
  const current = community!.adminIds;

  let next: string[];
  if (makeAdmin) {
    if (!member.isActive || !isFullMember(member)) {
      throw new HttpsError('failed-precondition', '管理者は、ルートコミュニティの会員から選んでください。');
    }
    next = current.includes(memberId) ? current : [...current, memberId];
  } else {
    next = current.filter((id) => id !== memberId);
    if (next.length === 0) {
      throw new HttpsError('failed-precondition', '最後の1人の管理者は外せません。');
    }
  }
  if (next.length === current.length && next.every((id) => current.includes(id))) {
    return { adminIds: current };
  }

  await communityRef!.update({ adminIds: next, updatedAt: FieldValue.serverTimestamp() });
  await syncCommunityAdmins(identity.tenantId, communityId, current, next);
  await recountCommunities(identity.tenantId, [communityId]);
  return { adminIds: next };
});

/**
 * メンバーを連携コミュニティから外す(管理者は、先に管理者から外す)。
 * 連携コミュニティだけに所属していた人は、ゲストと同じ扱いに戻る。
 */
export const removeCommunityMember = onCall(async (request) => {
  const { communityId, memberId } = readTarget(request.data);
  const { identity, community } = await requireScopeAdmin(request.auth, { type: 'community', communityId });
  if (community!.adminIds.includes(memberId)) {
    throw new HttpsError('failed-precondition', '管理者は外せません。先に管理者から外してください。');
  }
  const { ref, member } = await loadMember(identity.tenantId, memberId);
  if (!(member.communityIds ?? []).includes(communityId)) {
    throw new HttpsError('failed-precondition', 'この連携コミュニティのメンバーではありません。');
  }
  const { update, next } = communityRemoval(member, communityId);
  await ref.update(update);
  await syncMemberClaims(identity.tenantId, memberId, next);
  await recountCommunities(identity.tenantId, [communityId]);
  return { removed: true };
});

/** 連携コミュニティへの参加の申請を承認・否認する。承認すると、その連携コミュニティのメンバーになる。 */
export const decideCommunityApplication = onCall(async (request) => {
  const { communityId, memberId } = readTarget(request.data);
  const { approve, reason } = (request.data ?? {}) as { approve?: unknown; reason?: unknown };
  if (typeof approve !== 'boolean') {
    throw new HttpsError('invalid-argument', 'パラメータが不正です。');
  }
  const rejectReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
  const { identity } = await requireScopeAdmin(request.auth, { type: 'community', communityId });
  const memberRef = db().doc(`tenants/${identity.tenantId}/members/${memberId}`);

  const updated = await db().runTransaction(async (tx) => {
    const member = (await tx.get(memberRef)).data() as Member | undefined;
    const application = member?.communityApplications?.[communityId];
    if (!member || application?.status !== 'pending') {
      throw new HttpsError('failed-precondition', '審査待ちの申請がありません。');
    }
    const decided: MembershipApplication = {
      ...application,
      status: approve ? 'approved' : 'rejected',
      decidedAt: FieldValue.serverTimestamp(),
      decidedBy: identity.memberId,
      ...(approve || !rejectReason ? {} : { rejectReason }),
    };
    // ゲスト(ルートの会員でも、ほかの連携コミュニティのメンバーでもない人)は、連携コミュニティだけのメンバーになる。
    const becomesCommunity = approve && member.membership === 'guest';
    tx.update(memberRef, {
      [`communityApplications.${communityId}`]: decided,
      ...(approve ? { communityIds: FieldValue.arrayUnion(communityId) } : {}),
      ...(becomesCommunity ? { membership: 'community' } : {}),
    });
    return {
      ...member,
      ...(approve ? { communityIds: [...new Set([...(member.communityIds ?? []), communityId])] } : {}),
      ...(becomesCommunity ? { membership: 'community' as const } : {}),
    };
  });

  if (approve) {
    await syncMemberClaims(identity.tenantId, memberId, updated);
    await recountCommunities(identity.tenantId, [communityId]);
  }
  return { status: approve ? 'approved' : 'rejected' };
});

/** メンバー本人が、所属する連携コミュニティ独自のプロフィール項目を保存する。 */
export const updateCommunityProfile = onCall(async (request) => {
  const identity = requireCallerIdentity(request.auth);
  const { communityId, profile } = (request.data ?? {}) as { communityId?: unknown; profile?: unknown };
  if (typeof communityId !== 'string' || !communityId) {
    throw new HttpsError('invalid-argument', '連携コミュニティを指定してください。');
  }
  const [{ ref, member }, communitySnap] = await Promise.all([
    loadMember(identity.tenantId, identity.memberId),
    db().doc(communityPath(identity.tenantId, communityId)).get(),
  ]);
  const community = communitySnap.data() as Community | undefined;
  if (!community || !member.isActive || !(member.communityIds ?? []).includes(communityId)) {
    throw new HttpsError('permission-denied', 'この連携コミュニティのメンバーではありません。');
  }
  const fields = community.profileFields ?? [];
  // 連携コミュニティの項目は非公開にできないため、値はすべて会員データに置く。
  const { publicValues } = sanitizeProfileValues(fields, profile, {
    publicValues: member.communityProfiles?.[communityId] ?? {},
    privateValues: {},
  });
  await ref.update({ [`communityProfiles.${communityId}`]: publicValues });
  await upsertProfileOptions(identity.tenantId, fields, publicValues, (field) => profileOptionCategory(field.id, communityId));
  return { profile: publicValues };
});
