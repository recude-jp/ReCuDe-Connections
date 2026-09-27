import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { requireAdmin } from './callerIdentity';
import { requireScopeAdmin } from './adminScope';
import { sanitizeIconText } from './profile';
import { syncMemberClaims } from './memberClaims';
import type { Community, Invite, InviteCode, InviteIndexEntry, Member } from './models';

/**
 * 連携コミュニティ(SPEC 9章「連携 C1 の仕様」)。在京高校同窓会などの連携団体を、テナントの中の区画として扱う。
 * 追加・編集・削除はルートコミュニティの管理者が行う。参加者数(memberCount・rootMemberCount)はここで数え直す。
 */

const db = () => admin.firestore();

export const COMMUNITY_NAME_MAX_LENGTH = 50;
export const COMMUNITY_DESCRIPTION_MAX_LENGTH = 500;
/** テナントあたりの連携コミュニティの上限(所属は会員のカスタムクレームにも入れるため)。 */
export const COMMUNITY_LIMIT = 50;

export function communityPath(tenantId: string, communityId: string): string {
  return `tenants/${tenantId}/communities/${communityId}`;
}

/** ルートコミュニティの正規の会員か(区分が未設定なのは、ゲストの仕組みを入れる前からの正規の会員)。 */
export function isFullMember(member: Pick<Member, 'membership'>): boolean {
  return !member.membership || member.membership === 'member';
}

/** 会員データに、その連携コミュニティの記録(所属・管理者・申請・プロフィール)があるか。 */
function isInCommunityRecords(member: Member, communityId: string): boolean {
  return (
    (member.communityIds ?? []).includes(communityId) ||
    (member.adminCommunityIds ?? []).includes(communityId) ||
    !!member.communityApplications?.[communityId] ||
    !!member.communityProfiles?.[communityId]
  );
}

/**
 * 会員を連携コミュニティから外すときの更新(所属・管理者・申請・プロフィールの値を消す)と、更新後の会員データ。
 * 連携コミュニティだけに所属していた人は、ゲストと同じ扱いに戻す(SPEC 9章・未確定事項#32)。
 */
export function communityRemoval(member: Member, communityId: string): { update: Record<string, unknown>; next: Member } {
  const communityIds = (member.communityIds ?? []).filter((id) => id !== communityId);
  const backToGuest = member.membership === 'community' && communityIds.length === 0;
  const communityProfiles = { ...(member.communityProfiles ?? {}) };
  delete communityProfiles[communityId];
  const communityApplications = { ...(member.communityApplications ?? {}) };
  delete communityApplications[communityId];
  return {
    update: {
      communityIds: FieldValue.arrayRemove(communityId),
      adminCommunityIds: FieldValue.arrayRemove(communityId),
      [`communityProfiles.${communityId}`]: FieldValue.delete(),
      [`communityApplications.${communityId}`]: FieldValue.delete(),
      ...(backToGuest ? { membership: 'guest' } : {}),
    },
    next: {
      ...member,
      communityIds,
      adminCommunityIds: (member.adminCommunityIds ?? []).filter((id) => id !== communityId),
      communityProfiles,
      communityApplications,
      ...(backToGuest ? { membership: 'guest' as const } : {}),
    },
  };
}

/** 連携コミュニティの参加者数を数え直す(参加・削除・会員申請の承認・停止のあとに呼ぶ)。 */
export async function recountCommunities(tenantId: string, communityIds: string[] | undefined): Promise<void> {
  for (const communityId of new Set(communityIds ?? [])) {
    const ref = db().doc(communityPath(tenantId, communityId));
    const snap = await db()
      .collection(`tenants/${tenantId}/members`)
      .where('communityIds', 'array-contains', communityId)
      .get();
    const active = snap.docs.map((doc) => doc.data() as Member).filter((member) => member.isActive);
    try {
      await ref.update({
        memberCount: active.length,
        rootMemberCount: active.filter(isFullMember).length,
      });
    } catch (err) {
      // 数え直しのあいだに削除された連携コミュニティは無視する。
      if ((err as { code?: number }).code !== 5) {
        throw err;
      }
    }
  }
}

/** 名前・説明・ロゴのURLの入力を確かめる。 */
function sanitizeCommunityInput(data: Record<string, unknown>): Pick<Community, 'name'> & {
  description: string;
  logoUrl: string | null | undefined;
  /** undefined: 変えない。空文字: 未設定に戻す。 */
  logoText: string | undefined;
} {
  const name = typeof data['name'] === 'string' ? data['name'].trim() : '';
  if (!name) {
    throw new HttpsError('invalid-argument', '名称を入力してください。');
  }
  if (name.length > COMMUNITY_NAME_MAX_LENGTH) {
    throw new HttpsError('invalid-argument', `名称は${COMMUNITY_NAME_MAX_LENGTH}文字以内にしてください。`);
  }
  const description = typeof data['description'] === 'string' ? data['description'].trim() : '';
  if (description.length > COMMUNITY_DESCRIPTION_MAX_LENGTH) {
    throw new HttpsError('invalid-argument', `説明は${COMMUNITY_DESCRIPTION_MAX_LENGTH}文字以内にしてください。`);
  }
  // undefined: 変えない。null: ロゴを外す。
  const rawLogo = data['logoUrl'];
  let logoUrl: string | null | undefined;
  if (rawLogo === null) {
    logoUrl = null;
  } else if (typeof rawLogo === 'string') {
    if (!/^https?:\/\//.test(rawLogo) || rawLogo.length > 2000) {
      throw new HttpsError('invalid-argument', 'ロゴのURLが正しくありません。');
    }
    logoUrl = rawLogo;
  }
  const logoText = data['logoText'] === undefined ? undefined : sanitizeIconText(data['logoText']);
  return { name, description, logoUrl, logoText };
}

/**
 * 管理者に選ばれた会員を確かめる。管理者は、ルートコミュニティの有効な正規の会員でなければならない
 * (ゲスト・審査待ち・連携コミュニティだけのメンバーは選べない)。
 */
async function loadAdminMembers(tenantId: string, rawIds: unknown): Promise<Map<string, Member>> {
  if (!Array.isArray(rawIds) || rawIds.some((id) => typeof id !== 'string' || !id)) {
    throw new HttpsError('invalid-argument', '管理者を選んでください。');
  }
  const ids = [...new Set(rawIds as string[])];
  if (ids.length === 0) {
    throw new HttpsError('invalid-argument', '管理者を1人以上選んでください。');
  }
  if (ids.length > 20) {
    throw new HttpsError('invalid-argument', '管理者は20人までです。');
  }
  const snaps = await db().getAll(...ids.map((id) => db().doc(`tenants/${tenantId}/members/${id}`)));
  const members = new Map<string, Member>();
  for (const snap of snaps) {
    const member = snap.data() as Member | undefined;
    if (!member || !member.isActive || !isFullMember(member)) {
      throw new HttpsError(
        'failed-precondition',
        `${member?.displayName ?? '選ばれた人'}さんは管理者にできません。管理者はルートコミュニティの会員から選んでください。`,
      );
    }
    members.set(snap.id, member);
  }
  return members;
}

/**
 * 連携コミュニティの管理者の変更を会員データに反映する。新しい管理者はメンバーにもし(communityIds)、
 * 管理者になっている連携コミュニティ(adminCommunityIds)を揃えて、カスタムクレームも更新する。
 */
export async function syncCommunityAdmins(
  tenantId: string,
  communityId: string,
  previousAdminIds: string[],
  nextAdminIds: string[],
): Promise<void> {
  const added = nextAdminIds.filter((id) => !previousAdminIds.includes(id));
  const removed = previousAdminIds.filter((id) => !nextAdminIds.includes(id));
  if (added.length === 0 && removed.length === 0) {
    return;
  }
  const batch = db().batch();
  for (const id of added) {
    batch.update(db().doc(`tenants/${tenantId}/members/${id}`), {
      communityIds: FieldValue.arrayUnion(communityId),
      adminCommunityIds: FieldValue.arrayUnion(communityId),
    });
  }
  for (const id of removed) {
    batch.update(db().doc(`tenants/${tenantId}/members/${id}`), { adminCommunityIds: FieldValue.arrayRemove(communityId) });
  }
  await batch.commit();
  for (const id of [...added, ...removed]) {
    const member = (await db().doc(`tenants/${tenantId}/members/${id}`).get()).data() as Member | undefined;
    if (member) {
      await syncMemberClaims(tenantId, id, member);
    }
  }
}

/** 連携コミュニティを追加する。 */
export const createCommunity = onCall(async (request) => {
  const { identity } = await requireAdmin(request.auth);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const { name, description, logoUrl, logoText } = sanitizeCommunityInput(data);
  const admins = await loadAdminMembers(identity.tenantId, data['adminIds']);

  const collection = db().collection(`tenants/${identity.tenantId}/communities`);
  const existing = await collection.get();
  if (existing.size >= COMMUNITY_LIMIT) {
    throw new HttpsError('resource-exhausted', `連携コミュニティは${COMMUNITY_LIMIT}件までです。`);
  }
  if (existing.docs.some((doc) => (doc.data() as Community).name === name)) {
    throw new HttpsError('already-exists', '同じ名称の連携コミュニティがあります。');
  }

  const ref = collection.doc();
  const community: Community = {
    name,
    ...(description ? { description } : {}),
    ...(logoUrl ? { logoUrl } : {}),
    ...(logoText ? { logoText } : {}),
    adminIds: [...admins.keys()],
    memberCount: 0,
    rootMemberCount: 0,
    createdBy: identity.memberId,
    createdAt: FieldValue.serverTimestamp(),
  };
  await ref.set(community);
  await syncCommunityAdmins(identity.tenantId, ref.id, [], [...admins.keys()]);
  await recountCommunities(identity.tenantId, [ref.id]);
  return { communityId: ref.id };
});

/**
 * 連携コミュニティの名称・説明・ロゴ・管理者を変える(管理者を0人にはできない)。
 * ルートコミュニティの管理者(連携コミュニティの一覧)と、その連携コミュニティの管理者(サービス設定)が使う。
 * adminIds を省くと、管理者は変えない。
 */
export const updateCommunity = onCall(async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const communityId = typeof data['communityId'] === 'string' ? data['communityId'] : '';
  const { identity, community: current, communityRef: ref } = await requireScopeAdmin(request.auth, {
    type: 'community',
    communityId,
  });
  if (!ref || !current) {
    throw new HttpsError('not-found', '連携コミュニティが見つかりません。');
  }
  const { name, description, logoUrl, logoText } = sanitizeCommunityInput(data);
  const admins =
    data['adminIds'] === undefined ? null : await loadAdminMembers(identity.tenantId, data['adminIds']);

  if (name !== current.name) {
    const sameName = await db()
      .collection(`tenants/${identity.tenantId}/communities`)
      .where('name', '==', name)
      .get();
    if (sameName.docs.some((doc) => doc.id !== communityId)) {
      throw new HttpsError('already-exists', '同じ名称の連携コミュニティがあります。');
    }
  }

  await ref.update({
    name,
    description: description ? description : FieldValue.delete(),
    ...(logoUrl === undefined ? {} : { logoUrl: logoUrl ?? FieldValue.delete() }),
    ...(logoText === undefined ? {} : { logoText: logoText || FieldValue.delete() }),
    ...(admins ? { adminIds: [...admins.keys()] } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  });
  if (admins) {
    await syncCommunityAdmins(identity.tenantId, communityId, current.adminIds, [...admins.keys()]);
  }
  await recountCommunities(identity.tenantId, [communityId]);
  return { communityId };
});

/**
 * 連携コミュニティを削除する。確認のため名称を入力させる。
 * 全メンバーの所属から外し、その連携コミュニティへの招待リンク・QRコードを使えなくする。その連携コミュニティのスタンプは非表示にする。
 * 連携コミュニティだけに所属していた人は、ゲストと同じ扱いに戻す(SPEC 9章・未確定事項#32)。
 */
export const deleteCommunity = onCall(async (request) => {
  const { identity } = await requireAdmin(request.auth);
  const { communityId, confirmName } = (request.data ?? {}) as { communityId?: unknown; confirmName?: unknown };
  if (typeof communityId !== 'string' || !communityId) {
    throw new HttpsError('invalid-argument', '連携コミュニティを指定してください。');
  }
  const { tenantId } = identity;
  const ref = db().doc(communityPath(tenantId, communityId));
  const community = (await ref.get()).data() as Community | undefined;
  if (!community) {
    throw new HttpsError('not-found', '連携コミュニティが見つかりません。');
  }
  if (typeof confirmName !== 'string' || confirmName.trim() !== community.name) {
    throw new HttpsError('invalid-argument', '確認のための名称が一致しません。');
  }

  const [membersSnap, codesSnap, invitesSnap, stampPacksSnap] = await Promise.all([
    // メンバー・管理者・参加の申請をした人。件数が少ない前提で、テナントの会員をまとめて読んで絞る。
    db().collection(`tenants/${tenantId}/members`).get(),
    db().collection('inviteCodes').where('tenantId', '==', tenantId).where('communityId', '==', communityId).get(),
    db().collection(`tenants/${tenantId}/invites`).where('target.communityId', '==', communityId).get(),
    db().collection(`tenants/${tenantId}/stampPacks`).where('scope.communityId', '==', communityId).get(),
  ]);

  const updatedMembers: { id: string; member: Member }[] = [];
  const writes: ((batch: admin.firestore.WriteBatch) => void)[] = [];
  for (const doc of membersSnap.docs) {
    const member = doc.data() as Member;
    if (!isInCommunityRecords(member, communityId)) {
      continue;
    }
    const { update, next } = communityRemoval(member, communityId);
    writes.push((batch) => batch.update(doc.ref, update));
    updatedMembers.push({ id: doc.id, member: next });
  }
  for (const doc of codesSnap.docs) {
    if ((doc.data() as InviteCode).active) {
      writes.push((batch) => batch.update(doc.ref, { active: false }));
    }
  }
  for (const doc of invitesSnap.docs) {
    const invite = doc.data() as Invite;
    if (invite.status !== 'invited') {
      continue;
    }
    writes.push((batch) => batch.update(doc.ref, { status: 'canceled' }));
    if (invite.phoneNumber) {
      const indexRef = db().doc(`inviteIndex/${invite.phoneNumber}`);
      const index = (await indexRef.get()).data() as InviteIndexEntry | undefined;
      if (index?.tenantId === tenantId && index.inviteId === doc.id) {
        writes.push((batch) => batch.delete(indexRef));
      }
    }
  }
  // その連携コミュニティのスタンプは、非表示にして残す(送信済みのメッセージでは表示したまま)。
  for (const doc of stampPacksSnap.docs) {
    writes.push((batch) => batch.update(doc.ref, { hidden: true, updatedAt: FieldValue.serverTimestamp() }));
  }
  writes.push((batch) => batch.delete(ref));

  // 1回のバッチは500件まで。
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db().batch();
    writes.slice(i, i + 400).forEach((write) => write(batch));
    await batch.commit();
  }
  for (const { id, member } of updatedMembers) {
    await syncMemberClaims(tenantId, id, member);
  }
  // ロゴ画像も消す(無ければ何もしない)。
  await admin
    .storage()
    .bucket()
    .deleteFiles({ prefix: `tenants/${tenantId}/communities/${communityId}/` })
    .catch(() => undefined);

  return { removedMembers: updatedMembers.length };
});
