import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { requireCallerIdentity, requireFullMember } from './callerIdentity';
import type { CallerIdentity } from './callerIdentity';
import { communityPath, isFullMember, recountCommunities } from './communities';
import { buildMemberClaims } from './memberClaims';
import { sanitizeDisplayName } from './profile';
import { writeDirectRoom } from './rooms';
import { sendEmail } from './mail';
import { appBaseUrl, sendSms, twilioSecrets } from './twilio';
import type {
  Community,
  Connection,
  Invite,
  InviteCode,
  InviteIndexEntry,
  InviteTarget,
  Member,
  MembershipApplication,
  PhoneIndexEntry,
  Tenant,
} from './models';

/**
 * 招待とゲストの参加(SPEC 1章「方針の変更」)。
 * 正規の会員は、QRコード(会員ごとに1つ、作り直すまで有効)を見せるか、「招待の送付」(名前と、電話番号かメールアドレス)で
 * 招待リンク(/join?code=...)を送る。招待された人は電話番号でログインしてゲストになり、招待した人との1対1のトークができる。
 * 正規の会員になるには、ゲストがマイページの「会員登録」から申請し、管理者が審査する(membership.ts)。
 *
 * 招待先は、ルートコミュニティ(テナント本体)か、自分が所属する連携コミュニティから選ぶ(SPEC 9章「連携 C1 の仕様」)。
 * 連携コミュニティへの招待で新しく参加した人は、その連携コミュニティのメンバー(membership: 'community')になる。
 * すでにアカウントがある人が連携コミュニティへの招待リンクを開くと、その連携コミュニティが所属に加わる。
 */

const db = () => admin.firestore();

/** 招待リンクのコード(推測できないよう、ランダムな20文字)。 */
function newCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(randomBytes(20), (b) => alphabet[b % alphabet.length]).join('');
}

function joinUrl(code: string): string {
  return `${appBaseUrl.value()}/join?code=${code}`;
}

async function getMember(tenantId: string, memberId: string): Promise<Member | undefined> {
  return (await db().doc(`tenants/${tenantId}/members/${memberId}`).get()).data() as Member | undefined;
}

async function getCommunity(tenantId: string, communityId: string): Promise<Community | undefined> {
  return (await db().doc(communityPath(tenantId, communityId)).get()).data() as Community | undefined;
}

interface ResolvedTarget {
  identity: CallerIdentity;
  inviter: Member;
  /** 連携コミュニティへの招待のとき。 */
  communityId?: string;
  community?: Community;
}

/**
 * 招待先を確かめる。ルートコミュニティへは正規の会員だけが、連携コミュニティへはそのメンバーだけが招待できる
 * (ゲストは、連携コミュニティのメンバーでなければ招待できない)。
 */
async function resolveTarget(auth: CallableRequest['auth'], rawTarget: unknown): Promise<ResolvedTarget> {
  const target = (rawTarget ?? { type: 'root' }) as Partial<InviteTarget>;
  if (target.type === 'community') {
    const identity = requireCallerIdentity(auth);
    const communityId = typeof target.communityId === 'string' ? target.communityId : '';
    const [inviter, community] = await Promise.all([
      getMember(identity.tenantId, identity.memberId),
      communityId ? getCommunity(identity.tenantId, communityId) : Promise.resolve(undefined),
    ]);
    if (!community) {
      throw new HttpsError('not-found', '招待先の連携コミュニティが見つかりません。');
    }
    if (!inviter || !inviter.isActive || !(inviter.communityIds ?? []).includes(communityId)) {
      throw new HttpsError('permission-denied', 'この連携コミュニティへは、そのメンバーだけが招待できます。');
    }
    return { identity, inviter, communityId, community };
  }
  if (target.type !== 'root') {
    throw new HttpsError('invalid-argument', '招待先が正しくありません。');
  }
  const identity = requireFullMember(auth, '招待');
  const inviter = await getMember(identity.tenantId, identity.memberId);
  if (!inviter || !inviter.isActive || !isFullMember(inviter)) {
    throw new HttpsError('permission-denied', '招待は、正規の会員になるとできるようになります。');
  }
  return { identity, inviter };
}

/** 招待先ごとの自分のQRコード(有効なもの)。 */
async function findActiveQrCodes(
  identity: CallerIdentity,
  communityId: string | undefined,
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const snap = await db()
    .collection('inviteCodes')
    .where('inviterId', '==', identity.memberId)
    .where('tenantId', '==', identity.tenantId)
    .where('kind', '==', 'qr')
    .where('active', '==', true)
    .get();
  return snap.docs.filter((doc) => ((doc.data() as InviteCode).communityId ?? undefined) === communityId);
}

function newQrCode(identity: CallerIdentity, communityId: string | undefined): InviteCode {
  return {
    tenantId: identity.tenantId,
    inviterId: identity.memberId,
    kind: 'qr',
    ...(communityId ? { communityId } : {}),
    active: true,
    createdAt: FieldValue.serverTimestamp(),
  };
}

/** 自分のQRコード(招待先ごとに1つ。無ければ作る)。 */
export const getMyInviteQr = onCall(async (request) => {
  const { identity, communityId } = await resolveTarget(request.auth, (request.data ?? {})['target']);
  const existing = await findActiveQrCodes(identity, communityId);
  if (existing.length > 0) {
    return { code: existing[0].id, url: joinUrl(existing[0].id) };
  }
  const code = newCode();
  await db().doc(`inviteCodes/${code}`).set(newQrCode(identity, communityId));
  return { code, url: joinUrl(code) };
});

/** QRコードを作り直す(その招待先のこれまでのQRコードは使えなくなる。写真に撮られて広まったときなどに使う)。 */
export const regenerateInviteQr = onCall(async (request) => {
  const { identity, communityId } = await resolveTarget(request.auth, (request.data ?? {})['target']);
  const existing = await findActiveQrCodes(identity, communityId);
  const code = newCode();
  const batch = db().batch();
  existing.forEach((doc) => batch.update(doc.ref, { active: false }));
  batch.set(db().doc(`inviteCodes/${code}`), newQrCode(identity, communityId));
  await batch.commit();
  return { code, url: joinUrl(code) };
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

/**
 * 招待の送付。名前は必須で、電話番号(SMS)かメールアドレスのどちらかに招待リンクを送る(1回だけ使えるリンク)。
 * 既に参加している電話番号、有効な招待がある電話番号には送れない。ただし連携コミュニティへの招待は、
 * そのテナントにアカウントがあり、まだその連携コミュニティのメンバーでない人にも送れる。
 */
export const createInvite = onCall({ secrets: twilioSecrets }, async (request) => {
  const data = (request.data ?? {}) as { name?: unknown; phoneNumber?: unknown; email?: unknown; target?: unknown };
  const { identity, inviter, communityId, community } = await resolveTarget(request.auth, data.target);
  const name = sanitizeDisplayName(data.name);
  const phoneNumber = typeof data.phoneNumber === 'string' ? data.phoneNumber.trim() : '';
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  if (!phoneNumber && !email) {
    throw new HttpsError('invalid-argument', '電話番号かメールアドレスを入力してください。');
  }
  if (phoneNumber && !PHONE_PATTERN.test(phoneNumber)) {
    throw new HttpsError('invalid-argument', '電話番号の形式が正しくありません。');
  }
  if (email && (!EMAIL_PATTERN.test(email) || email.length > 200)) {
    throw new HttpsError('invalid-argument', 'メールアドレスの形式が正しくありません。');
  }

  /** 電話番号あての招待の逆引き(inviteIndex)を作るか。すでにアカウントがある人には作らない。 */
  let indexPhone = false;
  if (phoneNumber) {
    const [phoneIndexSnap, inviteIndexSnap] = await Promise.all([
      db().doc(`phoneIndex/${phoneNumber}`).get(),
      db().doc(`inviteIndex/${phoneNumber}`).get(),
    ]);
    const phoneIndex = phoneIndexSnap.data() as PhoneIndexEntry | undefined;
    if (phoneIndex) {
      const existing =
        communityId && phoneIndex.tenantId === identity.tenantId
          ? await getMember(identity.tenantId, phoneIndex.memberId)
          : undefined;
      if (!existing) {
        throw new HttpsError('already-exists', 'この電話番号の方は、すでに参加しています。');
      }
      if ((existing.communityIds ?? []).includes(communityId!)) {
        throw new HttpsError('already-exists', 'この電話番号の方は、すでにこの連携コミュニティのメンバーです。');
      }
    } else if (inviteIndexSnap.exists) {
      throw new HttpsError('already-exists', 'この電話番号には、すでに招待を送っています。');
    } else {
      indexPhone = true;
    }
  }

  const tenant = (await db().doc(`tenants/${identity.tenantId}`).get()).data() as Tenant | undefined;
  const serviceName = tenant?.branding?.siteTitle || tenant?.name || 'ReCuDe Connections';

  const code = newCode();
  const inviteRef = db().collection(`tenants/${identity.tenantId}/invites`).doc();
  const invite: Invite = {
    name,
    ...(phoneNumber ? { phoneNumber } : {}),
    ...(email ? { email } : {}),
    recommenderId: identity.memberId,
    via: 'invite',
    ...(communityId ? { target: { type: 'community', communityId } } : {}),
    code,
    status: 'invited',
    createdAt: FieldValue.serverTimestamp(),
  };
  const batch = db().batch();
  batch.set(inviteRef, invite);
  batch.set(db().doc(`inviteCodes/${code}`), {
    tenantId: identity.tenantId,
    inviterId: identity.memberId,
    kind: 'invite',
    inviteId: inviteRef.id,
    ...(communityId ? { communityId } : {}),
    active: true,
    createdAt: FieldValue.serverTimestamp(),
  } satisfies InviteCode);
  if (phoneNumber && indexPhone) {
    batch.set(db().doc(`inviteIndex/${phoneNumber}`), { tenantId: identity.tenantId, inviteId: inviteRef.id } satisfies InviteIndexEntry);
  }
  await batch.commit();

  const inviterName = inviter.displayName;
  const place = community ? `${serviceName}の「${community.name}」` : serviceName;
  const message = `${name}さん、${inviterName}さんから${place}に招待されました。次のリンクから参加できます。\n${joinUrl(code)}`;
  if (phoneNumber) {
    await sendSms(phoneNumber, message);
  } else {
    await sendEmail(email, `${inviterName}さんから${place}への招待`, message);
  }

  return { inviteId: inviteRef.id };
});

interface ResolvedInvitation {
  tenantId: string;
  inviterId: string;
  via: 'qr' | 'invite';
  /** 連携コミュニティへの招待のとき。 */
  communityId?: string;
  community?: Community;
  /** 招待の送付のとき。 */
  inviteRef?: FirebaseFirestore.DocumentReference;
  invite?: Invite;
  codeRef?: FirebaseFirestore.DocumentReference;
}

/**
 * 招待リンクのコード(QRコード・招待の送付)から招待を探す。コードが無いときは、電話番号あての招待(ゲストの仕組みを
 * 入れる前のSMS招待を含む)を探す。見つからない・使えないときは理由付きで HttpsError を投げる。
 */
async function resolveInvitation(code: string | undefined, phoneNumber: string | undefined): Promise<ResolvedInvitation> {
  const resolved = await findInvitation(code, phoneNumber);
  if (!resolved.communityId) {
    return resolved;
  }
  const community = await getCommunity(resolved.tenantId, resolved.communityId);
  if (!community) {
    throw new HttpsError('not-found', '招待先の連携コミュニティはなくなりました。');
  }
  return { ...resolved, community };
}

async function findInvitation(code: string | undefined, phoneNumber: string | undefined): Promise<ResolvedInvitation> {
  if (code) {
    const codeRef = db().doc(`inviteCodes/${code}`);
    const entry = (await codeRef.get()).data() as InviteCode | undefined;
    if (!entry || !entry.active) {
      throw new HttpsError('not-found', 'この招待リンクは使えません（QRコードが作り直されたか、すでに使われています）。');
    }
    if (entry.kind === 'qr') {
      return { tenantId: entry.tenantId, inviterId: entry.inviterId, via: 'qr', communityId: entry.communityId, codeRef };
    }
    const inviteRef = db().doc(`tenants/${entry.tenantId}/invites/${entry.inviteId}`);
    const invite = (await inviteRef.get()).data() as Invite | undefined;
    if (!invite || invite.status !== 'invited') {
      throw new HttpsError('not-found', 'この招待はすでに使われています。');
    }
    return {
      tenantId: entry.tenantId,
      inviterId: invite.recommenderId,
      via: 'invite',
      communityId: invite.target?.communityId,
      inviteRef,
      invite,
      codeRef,
    };
  }
  if (phoneNumber) {
    const index = (await db().doc(`inviteIndex/${phoneNumber}`).get()).data() as InviteIndexEntry | undefined;
    if (index) {
      const inviteRef = db().doc(`tenants/${index.tenantId}/invites/${index.inviteId}`);
      const invite = (await inviteRef.get()).data() as Invite | undefined;
      if (invite && (invite.status === 'invited' || invite.status === 'submitted')) {
        const codeRef = invite.code ? db().doc(`inviteCodes/${invite.code}`) : undefined;
        return {
          tenantId: index.tenantId,
          inviterId: invite.recommenderId,
          via: 'invite',
          communityId: invite.target?.communityId,
          inviteRef,
          invite,
          codeRef,
        };
      }
    }
  }
  throw new HttpsError('not-found', '招待が見つかりません。招待してくれた方に、招待リンクかQRコードをもらってください。');
}

/**
 * 招待リンクを開いたときに出す案内(組織名・招待した人・名前の初期値)。ログイン前でも呼べる
 * (コードは推測できないため、コードを知っている人にだけ招待した人の名前を見せる)。
 */
export const getInvitePreview = onCall(async (request) => {
  const { code } = (request.data ?? {}) as { code?: unknown };
  const phoneNumber = request.auth?.token['phone_number'] as string | undefined;
  const resolved = await resolveInvitation(typeof code === 'string' && code ? code : undefined, phoneNumber);
  const [tenantSnap, inviter, phoneIndexSnap] = await Promise.all([
    db().doc(`tenants/${resolved.tenantId}`).get(),
    getMember(resolved.tenantId, resolved.inviterId),
    phoneNumber ? db().doc(`phoneIndex/${phoneNumber}`).get() : Promise.resolve(null),
  ]);
  const phoneIndex = phoneIndexSnap?.data() as PhoneIndexEntry | undefined;
  const joinedMember =
    phoneIndex?.tenantId === resolved.tenantId ? await getMember(phoneIndex.tenantId, phoneIndex.memberId) : undefined;
  const tenant = tenantSnap.data() as Tenant | undefined;
  return {
    tenantName: tenant?.name ?? '',
    serviceName: tenant?.branding?.siteTitle || tenant?.name || '',
    inviterName: inviter?.displayName ?? '会員',
    name: resolved.invite?.name ?? resolved.invite?.candidateProfile?.displayName ?? '',
    // ログイン中の電話番号で、すでに参加しているか(名前の入力を省く)。
    alreadyJoined: !!phoneIndex,
    // すでにこの招待先に参加しているか(ルートへの招待はアカウントがあれば参加済み)。
    alreadyInTarget: resolved.communityId
      ? (joinedMember?.communityIds ?? []).includes(resolved.communityId)
      : !!phoneIndex,
    // 連携コミュニティへの参加の申請が審査待ちか。
    pendingApproval: resolved.communityId
      ? joinedMember?.communityApplications?.[resolved.communityId]?.status === 'pending'
      : false,
    // 連携コミュニティへの招待のとき、招待先の名称・ロゴ・説明・参加の条件・承認が必要か。
    community: resolved.community
      ? {
          name: resolved.community.name,
          logoUrl: resolved.community.logoUrl ?? null,
          logoText: resolved.community.logoText ?? '',
          description: resolved.community.description ?? '',
          terms: resolved.community.membershipTerms
            ? {
                format: resolved.community.membershipTerms.format,
                body: resolved.community.membershipTerms.body,
                requireAgreement: resolved.community.membershipTerms.requireAgreement,
              }
            : null,
          requireApproval: resolved.community.requireApproval === true,
        }
      : null,
  };
});

/** 招待した人とのつながり(承認済み)と1対1のトークを作る(まだ承認済みのつながりがないときだけ)。 */
async function connectWithInviter(
  batch: admin.firestore.WriteBatch,
  tenantId: string,
  member: { id: string; displayName: string },
  inviter: { id: string; displayName: string },
  isNewMember: boolean,
): Promise<void> {
  const memberIds = [member.id, inviter.id].sort();
  const connectionId = memberIds.join('_');
  const connectionRef = db().doc(`tenants/${tenantId}/connections/${connectionId}`);
  if (!isNewMember) {
    const existing = (await connectionRef.get()).data() as Connection | undefined;
    if (existing?.status === 'accepted') {
      return;
    }
  }
  const connection: Connection = {
    memberIds,
    requestedBy: inviter.id,
    status: 'accepted',
    createdAt: FieldValue.serverTimestamp(),
    respondedAt: FieldValue.serverTimestamp(),
  };
  batch.set(connectionRef, connection);
  writeDirectRoom(batch, tenantId, connectionId, [
    { id: member.id, member: { displayName: member.displayName } },
    { id: inviter.id, member: { displayName: inviter.displayName } },
  ]);
}

/** 招待を使ったことを記録する(招待の送付は1回だけ使える。QRコードは、招待した人の記録として残す)。 */
async function recordInvitationUse(
  batch: admin.firestore.WriteBatch,
  resolved: ResolvedInvitation,
  member: { id: string; displayName: string; phoneNumber: string },
): Promise<void> {
  if (resolved.inviteRef) {
    batch.update(resolved.inviteRef, {
      status: 'joined',
      resultingMemberId: member.id,
      joinedAt: FieldValue.serverTimestamp(),
    });
    const indexRef = db().doc(`inviteIndex/${member.phoneNumber}`);
    const index = (await indexRef.get()).data() as InviteIndexEntry | undefined;
    if (index && index.inviteId === resolved.inviteRef.id) {
      batch.delete(indexRef);
    }
    if (resolved.codeRef) {
      batch.update(resolved.codeRef, { active: false });
    }
    return;
  }
  batch.set(db().collection(`tenants/${resolved.tenantId}/invites`).doc(), {
    name: member.displayName,
    phoneNumber: member.phoneNumber,
    recommenderId: resolved.inviterId,
    via: 'qr',
    ...(resolved.communityId ? { target: { type: 'community', communityId: resolved.communityId } } : {}),
    status: 'joined',
    resultingMemberId: member.id,
    createdAt: FieldValue.serverTimestamp(),
    joinedAt: FieldValue.serverTimestamp(),
  } satisfies Invite);
}

interface CommunityJoinResult {
  tenantId: string;
  memberId: string;
  alreadyJoined: boolean;
  joinedCommunity: string | null;
  /** 参加に管理者の承認が必要で、審査待ちになったか。 */
  pendingApproval: boolean;
}

/** 連携コミュニティの参加の条件への同意を確かめ、申請の記録を作る(承認が必要なら審査待ち、不要なら承認済み)。 */
function communityApplicationFor(community: Community, agreedToTerms: unknown): MembershipApplication | null {
  const terms = community.membershipTerms;
  if (terms?.requireAgreement && agreedToTerms !== true) {
    throw new HttpsError('failed-precondition', '参加の条件を確認し、同意してから参加してください。');
  }
  const termsAgreement = terms?.requireAgreement
    ? { termsAgreement: { agreedAt: FieldValue.serverTimestamp(), termsUpdatedAt: terms.updatedAt ?? null } }
    : {};
  if (community.requireApproval) {
    return { status: 'pending', submittedAt: FieldValue.serverTimestamp(), ...termsAgreement };
  }
  // 承認が要らないときも、同意した記録は残す。
  return terms?.requireAgreement
    ? { status: 'approved', submittedAt: FieldValue.serverTimestamp(), decidedAt: FieldValue.serverTimestamp(), ...termsAgreement }
    : null;
}

/**
 * 招待した人が、今もその招待先に招待できるかを確かめる(アカウントの停止・連携コミュニティからの脱退などのあと)。
 */
function assertInviterCanInvite(inviter: Member | undefined, communityId: string | undefined): asserts inviter is Member {
  const ok =
    !!inviter &&
    inviter.isActive &&
    (communityId ? (inviter.communityIds ?? []).includes(communityId) : isFullMember(inviter));
  if (!ok) {
    throw new HttpsError('failed-precondition', '招待した方のアカウントが無効のため、参加できません。');
  }
}

/**
 * すでにアカウントがある人が、連携コミュニティへの招待リンクを開いて参加する。その連携コミュニティが所属に加わり
 * (複数所属できる)、招待した人とのつながりと1対1のトークができる。
 */
async function joinCommunityWithExistingAccount(
  uid: string,
  phoneNumber: string,
  phoneIndex: PhoneIndexEntry,
  resolved: ResolvedInvitation & { communityId: string; community: Community },
  agreedToTerms: unknown,
): Promise<CommunityJoinResult> {
  const { tenantId, memberId } = phoneIndex;
  const memberRef = db().doc(`tenants/${tenantId}/members/${memberId}`);
  const [member, inviter] = await Promise.all([
    (async () => (await memberRef.get()).data() as Member | undefined)(),
    getMember(tenantId, resolved.inviterId),
  ]);
  if (!member || !member.isActive) {
    throw new HttpsError('permission-denied', 'このアカウントは現在無効になっています。');
  }
  const { communityId, community } = resolved;
  if ((member.communityIds ?? []).includes(communityId)) {
    return { tenantId, memberId, alreadyJoined: true, joinedCommunity: null, pendingApproval: false };
  }
  if (member.communityApplications?.[communityId]?.status === 'pending') {
    return { tenantId, memberId, alreadyJoined: true, joinedCommunity: null, pendingApproval: true };
  }
  assertInviterCanInvite(inviter, communityId);
  const application = communityApplicationFor(community, agreedToTerms);
  const pending = application?.status === 'pending';

  const batch = db().batch();
  batch.update(memberRef, {
    ...(pending ? {} : { communityIds: FieldValue.arrayUnion(communityId) }),
    ...(application ? { [`communityApplications.${communityId}`]: application } : {}),
  });
  if (resolved.inviterId !== memberId) {
    await connectWithInviter(
      batch,
      tenantId,
      { id: memberId, displayName: member.displayName },
      { id: resolved.inviterId, displayName: inviter.displayName },
      false,
    );
  }
  await recordInvitationUse(batch, resolved, { id: memberId, displayName: member.displayName, phoneNumber });
  await batch.commit();

  if (!pending) {
    const updated: Member = { ...member, communityIds: [...(member.communityIds ?? []), communityId] };
    await admin.auth().setCustomUserClaims(uid, buildMemberClaims(tenantId, memberId, updated));
    await recountCommunities(tenantId, [communityId]);
  }
  return { tenantId, memberId, alreadyJoined: true, joinedCommunity: community.name, pendingApproval: pending };
}

/**
 * 招待された人が、電話番号でログインしたあとに参加する。
 * - ルートコミュニティへの招待: ゲストになる(正規の会員になるには、マイページの「会員登録」から申請する)。
 * - 連携コミュニティへの招待: その連携コミュニティのメンバー(membership: 'community')になる。参加に承認が必要な
 *   連携コミュニティでは、申請が審査待ちになり(ゲストとして参加)、その連携コミュニティの管理者が承認するとメンバーになる。
 *   参加の条件への同意を求める連携コミュニティでは、agreedToTerms が必要。
 * 会員データ・電話番号の索引を作り、招待した人とのつながり(承認済み)と1対1のトークを作る。
 * 既に参加している電話番号なら、連携コミュニティへの招待のときはその所属を加え、そうでなければ何もせずに返す。
 */
export const joinAsGuest = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'ログインが必要です。');
  }
  const phoneNumber = request.auth.token['phone_number'] as string | undefined;
  if (!phoneNumber) {
    throw new HttpsError('failed-precondition', '電話番号でのログインが必要です。');
  }
  const { code: rawCode, displayName: rawName, agreedToTerms } = (request.data ?? {}) as {
    code?: unknown;
    displayName?: unknown;
    agreedToTerms?: unknown;
  };
  const code = typeof rawCode === 'string' && rawCode ? rawCode : undefined;

  const phoneIndex = (await db().doc(`phoneIndex/${phoneNumber}`).get()).data() as PhoneIndexEntry | undefined;
  if (phoneIndex) {
    const alreadyJoined: CommunityJoinResult = {
      tenantId: phoneIndex.tenantId,
      memberId: phoneIndex.memberId,
      alreadyJoined: true,
      joinedCommunity: null,
      pendingApproval: false,
    };
    if (!code) {
      return alreadyJoined;
    }
    // 使えなくなった招待リンクでも、すでに参加している人はそのままログインできるようにする(従来どおり)。
    const resolved = await resolveInvitation(code, phoneNumber).catch(() => null);
    if (!resolved?.communityId || !resolved.community || resolved.tenantId !== phoneIndex.tenantId) {
      return alreadyJoined;
    }
    if (resolved.invite?.phoneNumber && resolved.invite.phoneNumber !== phoneNumber) {
      throw new HttpsError('permission-denied', 'この招待は別の電話番号あてです。招待を受けた電話番号でログインしてください。');
    }
    return joinCommunityWithExistingAccount(request.auth.uid, phoneNumber, phoneIndex, {
      ...resolved,
      communityId: resolved.communityId,
      community: resolved.community,
    }, agreedToTerms);
  }

  const displayName = sanitizeDisplayName(rawName);
  const resolved = await resolveInvitation(code, phoneNumber);
  if (resolved.invite?.phoneNumber && resolved.invite.phoneNumber !== phoneNumber) {
    throw new HttpsError(
      'permission-denied',
      'この招待は別の電話番号あてです。招待を受けた電話番号でログインしてください。',
    );
  }
  const inviter = await getMember(resolved.tenantId, resolved.inviterId);
  assertInviterCanInvite(inviter, resolved.communityId);

  const { tenantId, communityId } = resolved;
  const application = resolved.community ? communityApplicationFor(resolved.community, agreedToTerms) : null;
  const pending = application?.status === 'pending';
  /** 連携コミュニティのメンバーになるか(承認が必要なときは、承認されるまでゲスト)。 */
  const joinsCommunity = !!communityId && !pending;
  const memberRef = db().collection(`tenants/${tenantId}/members`).doc();
  const member: Member = {
    phoneNumber,
    displayName,
    profile: {},
    positionLevel: '一般会員',
    roles: { recommender: false },
    membership: joinsCommunity ? 'community' : 'guest',
    ...(joinsCommunity ? { communityIds: [communityId!] } : {}),
    ...(application && communityId ? { communityApplications: { [communityId]: application } } : {}),
    isActive: true,
    invitedBy: resolved.inviterId,
    invitedVia: resolved.via,
    createdAt: FieldValue.serverTimestamp(),
  };

  const batch = db().batch();
  batch.set(memberRef, member);
  batch.set(db().doc(`phoneIndex/${phoneNumber}`), { tenantId, memberId: memberRef.id } satisfies PhoneIndexEntry);
  await connectWithInviter(
    batch,
    tenantId,
    { id: memberRef.id, displayName },
    { id: resolved.inviterId, displayName: inviter.displayName },
    true,
  );
  await recordInvitationUse(batch, resolved, { id: memberRef.id, displayName, phoneNumber });
  await batch.commit();

  await admin.auth().setCustomUserClaims(request.auth.uid, buildMemberClaims(tenantId, memberRef.id, member));
  if (joinsCommunity) {
    await recountCommunities(tenantId, [communityId!]);
  }
  return {
    tenantId,
    memberId: memberRef.id,
    alreadyJoined: false,
    joinedCommunity: resolved.community?.name ?? null,
    pendingApproval: pending,
  } satisfies CommunityJoinResult;
});
