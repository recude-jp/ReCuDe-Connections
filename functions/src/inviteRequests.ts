import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'crypto';
import { requireAdmin } from './callerIdentity';
import { issueInvite } from './invites';
import { messagingSecrets } from './mail';
import type { Community, InviteRequest, Tenant } from './models';

/**
 * 招待申請(SPEC 1章「招待申請」)。利用の条件は、東京岐阜県人会の会員か、連携している在京同窓会の会員であること。
 * 会員に知り合いがいない人が公開フォームから申請し、事務局(ルートの管理者)が名簿などで確かめてから招待を送る。
 */

const db = () => admin.firestore();

const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOUR_MS = 60 * 60 * 1000;
/** 同じ接続元からの、1時間あたりの申請の上限(いたずらの大量送信を防ぐ)。 */
const REQUESTS_PER_HOUR_PER_IP = 5;

function requestsPath(tenantId: string): string {
  return `tenants/${tenantId}/inviteRequests`;
}

function text(value: unknown, label: string, max: number, required = false): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (required && !result) {
    throw new HttpsError('invalid-argument', `${label}を入力してください。`);
  }
  if (result.length > max) {
    throw new HttpsError('invalid-argument', `${label}は${max}文字以内で入力してください。`);
  }
  return result;
}

/** 申請を受け付けるテナント(有効なものだけ)。 */
async function getOpenTenant(tenantId: unknown): Promise<{ id: string; tenant: Tenant }> {
  const id = typeof tenantId === 'string' ? tenantId : '';
  const tenant = id ? ((await db().doc(`tenants/${id}`).get()).data() as Tenant | undefined) : undefined;
  if (!tenant || !tenant.isActive) {
    throw new HttpsError('not-found', '申請を受け付けていません。');
  }
  return { id, tenant };
}

async function listCommunities(tenantId: string): Promise<{ id: string; name: string }[]> {
  const snap = await db().collection(`tenants/${tenantId}/communities`).get();
  return snap.docs
    .map((doc) => ({ id: doc.id, name: (doc.data() as Community).name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

/** 申請フォームの選択肢(在京同窓会＝連携コミュニティの名前)。未ログインで呼べる。 */
export const getInviteRequestOptions = onCall(async (request) => {
  const { id } = await getOpenTenant((request.data ?? {}).tenantId);
  return { communities: await listCommunities(id) };
});

/** 招待を申請する。未ログインで呼べる。 */
export const submitInviteRequest = onCall(async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const { id: tenantId } = await getOpenTenant(data['tenantId']);

  const name = text(data['name'], 'お名前', 30, true);
  const phoneNumber = text(data['phoneNumber'], '電話番号', 20, true);
  if (!PHONE_PATTERN.test(phoneNumber)) {
    throw new HttpsError('invalid-argument', '電話番号の形式が正しくありません。');
  }
  const email = text(data['email'], 'メールアドレス', 200).toLowerCase();
  if (email && !EMAIL_PATTERN.test(email)) {
    throw new HttpsError('invalid-argument', 'メールアドレスの形式が正しくありません。');
  }
  const hometown = text(data['hometown'], '出身地', 50, true);
  const highSchool = text(data['highSchool'], '出身高校', 50);
  const juniorHighSchool = text(data['juniorHighSchool'], '出身中学', 50);
  if (!highSchool && !juniorHighSchool) {
    throw new HttpsError('invalid-argument', '出身高校か出身中学を入力してください。');
  }
  const kenjinkaiMember = data['kenjinkaiMember'] === true;
  const alumniMember = data['alumniMember'] === true;
  if (!kenjinkaiMember && !alumniMember) {
    throw new HttpsError(
      'failed-precondition',
      'ご利用には、東京岐阜県人会の会員か、連携している在京同窓会の会員であることが必要です。',
    );
  }
  let alumniCommunityId = '';
  let alumniOtherName = '';
  if (alumniMember) {
    alumniCommunityId = typeof data['alumniCommunityId'] === 'string' ? data['alumniCommunityId'] : '';
    if (alumniCommunityId) {
      if (!(await db().doc(`tenants/${tenantId}/communities/${alumniCommunityId}`).get()).exists) {
        throw new HttpsError('invalid-argument', '在京同窓会を選び直してください。');
      }
    } else {
      alumniOtherName = text(data['alumniOtherName'], '在京同窓会の名前', 50, true);
    }
  }
  const referrer = text(data['referrer'], '紹介者', 30);
  const note = text(data['note'], 'ご質問・ご連絡', 500);
  if (data['agreed'] !== true) {
    throw new HttpsError('invalid-argument', '入力内容の取り扱いに同意してください。');
  }

  // 同じ電話番号で確認待ちの申請があれば、重ねて受け付けない。
  const pending = await db()
    .collection(requestsPath(tenantId))
    .where('phoneNumber', '==', phoneNumber)
    .where('status', '==', 'pending')
    .limit(1)
    .get();
  if (!pending.empty) {
    throw new HttpsError('already-exists', 'この電話番号の申請は、すでに受け付けています。事務局からのご連絡をお待ちください。');
  }

  const [phoneIndexSnap, inviteIndexSnap] = await Promise.all([
    db().doc(`phoneIndex/${phoneNumber}`).get(),
    db().doc(`inviteIndex/${phoneNumber}`).get(),
  ]);
  const inviteRequest: InviteRequest = {
    name,
    phoneNumber,
    ...(email ? { email } : {}),
    hometown,
    ...(highSchool ? { highSchool } : {}),
    ...(juniorHighSchool ? { juniorHighSchool } : {}),
    kenjinkaiMember,
    alumniMember,
    ...(alumniCommunityId ? { alumniCommunityId } : {}),
    ...(alumniOtherName ? { alumniOtherName } : {}),
    ...(referrer ? { referrer } : {}),
    ...(note ? { note } : {}),
    status: 'pending',
    alreadyJoined: phoneIndexSnap.data()?.['tenantId'] === tenantId,
    alreadyInvited: inviteIndexSnap.exists,
    createdAt: FieldValue.serverTimestamp(),
  };

  const now = Date.now();
  const ip = request.rawRequest?.ip;
  const limitRef = ip ? db().doc(`inviteRequestRateLimits/${createHash('sha256').update(`ip:${ip}`).digest('hex')}`) : null;
  const requestRef = db().collection(requestsPath(tenantId)).doc();
  await db().runTransaction(async (tx) => {
    if (limitRef) {
      const sentAt = (((await tx.get(limitRef)).data()?.['sentAt'] ?? []) as Timestamp[]).filter(
        (t) => t.toMillis() > now - HOUR_MS,
      );
      if (sentAt.length >= REQUESTS_PER_HOUR_PER_IP) {
        throw new HttpsError('resource-exhausted', '申請の回数が上限に達しました。しばらく時間をおいてから、もう一度お試しください。');
      }
      tx.set(limitRef, { sentAt: [...sentAt, Timestamp.fromMillis(now)] });
    }
    tx.set(requestRef, inviteRequest);
  });
  return { received: true };
});

/**
 * 事務局が招待申請に応える。invite: 招待を送る(招待先はルートか連携コミュニティ。招待した人は事務局の担当者になる)。
 * decline: 見送る(申請者には送らない。必要なら事務局から個別に連絡する)。
 */
export const decideInviteRequest = onCall({ secrets: messagingSecrets }, async (request) => {
  const { identity, member: adminMember } = await requireAdmin(request.auth);
  const { requestId, decision, communityId: rawCommunityId, channel, declineReason } = (request.data ?? {}) as {
    requestId?: unknown;
    decision?: unknown;
    communityId?: unknown;
    channel?: unknown;
    declineReason?: unknown;
  };
  if (typeof requestId !== 'string' || !requestId) {
    throw new HttpsError('invalid-argument', 'リクエストが不正です。');
  }
  const requestRef = db().doc(`${requestsPath(identity.tenantId)}/${requestId}`);
  const inviteRequest = (await requestRef.get()).data() as InviteRequest | undefined;
  if (!inviteRequest) {
    throw new HttpsError('not-found', '申請が見つかりません。');
  }
  if (inviteRequest.status !== 'pending') {
    throw new HttpsError('failed-precondition', 'この申請は、すでに対応済みです。');
  }

  if (decision === 'decline') {
    const reason = text(declineReason, '理由', 500);
    await requestRef.update({
      status: 'declined',
      ...(reason ? { declineReason: reason } : {}),
      handledBy: identity.memberId,
      handledAt: FieldValue.serverTimestamp(),
    });
    return { status: 'declined' };
  }
  if (decision !== 'invite') {
    throw new HttpsError('invalid-argument', 'リクエストが不正です。');
  }

  const communityId = typeof rawCommunityId === 'string' && rawCommunityId ? rawCommunityId : undefined;
  const community = communityId
    ? ((await db().doc(`tenants/${identity.tenantId}/communities/${communityId}`).get()).data() as Community | undefined)
    : undefined;
  if (communityId && !community) {
    throw new HttpsError('not-found', '招待先の連携コミュニティが見つかりません。');
  }
  const byEmail = channel === 'email';
  if (byEmail && !inviteRequest.email) {
    throw new HttpsError('failed-precondition', 'この申請にはメールアドレスがありません。');
  }

  const inviteId = await issueInvite({
    tenantId: identity.tenantId,
    inviterId: identity.memberId,
    inviter: adminMember,
    communityId,
    community,
    name: inviteRequest.name,
    // 参加するときは電話番号で確認するため、メールで送るときも電話番号あての招待として記録する。
    phoneNumber: inviteRequest.phoneNumber,
    email: byEmail ? inviteRequest.email : undefined,
    requestId,
    ...(byEmail ? { sendBy: 'email' as const } : {}),
  });
  await requestRef.update({
    status: 'invited',
    inviteId,
    ...(communityId ? { invitedCommunityId: communityId } : {}),
    handledBy: identity.memberId,
    handledAt: FieldValue.serverTimestamp(),
  });
  return { status: 'invited', inviteId };
});
