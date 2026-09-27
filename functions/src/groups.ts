import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { CallerIdentity, requireCallerIdentity, requireFullMember } from './callerIdentity';
import { isFullMember } from './communities';
import type { GroupInvitationNotice, Member, Room, RoomInvitation, RoomMember, RoomMessage } from './models';
import {
  GROUP_DESCRIPTION_MAX_LENGTH,
  GROUP_MEMBER_LIMIT,
  GROUP_NAME_MAX_LENGTH,
  groupInvitationNoticePath,
  newThread,
  roomPath,
  summarizeMessage,
  threadPath,
} from './rooms';

/**
 * グループ(トークのgroupルーム)の作成・招待・参加・退出。
 * グループには招待でのみ参加でき、招待された側が「参加する／断る」を選ぶ(SPEC 5-2)。
 * グループ管理者(role: 'admin')は複数人でき、常に1人以上いる。
 * 招待元(invitedBy)は、事務局のリレーション監視・信頼ポイントのために記録する。
 */

function db(): admin.firestore.Firestore {
  return admin.firestore();
}

function memberRef(tenantId: string, memberId: string): admin.firestore.DocumentReference {
  return db().doc(`tenants/${tenantId}/members/${memberId}`);
}

function parseInviteeIds(value: unknown, selfId: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id)) {
    throw new HttpsError('invalid-argument', '招待する会員の指定が不正です。');
  }
  return [...new Set(value as string[])].filter((id) => id !== selfId);
}

/**
 * 招待を書き込む(トランザクション内)。招待される会員は同一テナントの有効な会員で、
 * まだメンバーでなく、保留中の招待もないこと。呼び出し側で読み取りを済ませておく。
 */
function writeInvitations(
  tx: admin.firestore.Transaction,
  identity: CallerIdentity,
  roomId: string,
  roomName: string,
  inviterName: string,
  invitees: { id: string; member: Member | undefined; alreadyMember: boolean; pending: boolean }[],
): string[] {
  const invited: string[] = [];
  for (const invitee of invitees) {
    // ゲスト(まだ正規の会員でない人)はグループに参加できない。
    if (
      !invitee.member ||
      !invitee.member.isActive ||
      !isFullMember(invitee.member) ||
      invitee.alreadyMember ||
      invitee.pending
    ) {
      continue;
    }
    const invitation: RoomInvitation = {
      inviteeId: invitee.id,
      invitedBy: identity.memberId,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    };
    const notice: GroupInvitationNotice = {
      roomName,
      invitedBy: identity.memberId,
      invitedByName: inviterName,
      createdAt: FieldValue.serverTimestamp(),
    };
    tx.set(db().doc(`${roomPath(identity.tenantId, roomId)}/invitations/${invitee.id}`), invitation);
    tx.set(db().doc(groupInvitationNoticePath(identity.tenantId, invitee.id, roomId)), notice);
    invited.push(invitee.id);
  }
  return invited;
}

/** グループを作成する。作成者が最初のグループ管理者になる。同時にメンバーを招待できる。 */
export const createGroup = onCall(async (request) => {
  const identity = requireFullMember(request.auth, 'グループの作成');
  const data = (request.data ?? {}) as { name?: unknown; description?: unknown; inviteeIds?: unknown };

  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  if (!name || name.length > GROUP_NAME_MAX_LENGTH) {
    throw new HttpsError('invalid-argument', `グループ名は1〜${GROUP_NAME_MAX_LENGTH}文字で入力してください。`);
  }
  if (description.length > GROUP_DESCRIPTION_MAX_LENGTH) {
    throw new HttpsError('invalid-argument', `説明は${GROUP_DESCRIPTION_MAX_LENGTH}文字以内で入力してください。`);
  }
  const inviteeIds = parseInviteeIds(data.inviteeIds, identity.memberId);
  if (inviteeIds.length + 1 > GROUP_MEMBER_LIMIT) {
    throw new HttpsError('invalid-argument', `グループの人数は${GROUP_MEMBER_LIMIT}人までです。`);
  }

  const roomRef = db().collection(`tenants/${identity.tenantId}/rooms`).doc();

  const invited = await db().runTransaction(async (tx) => {
    const [creatorSnap, ...inviteeSnaps] = await Promise.all([
      tx.get(memberRef(identity.tenantId, identity.memberId)),
      ...inviteeIds.map((id) => tx.get(memberRef(identity.tenantId, id))),
    ]);
    const creator = creatorSnap.data() as Member | undefined;
    if (!creator || !creator.isActive) {
      throw new HttpsError('permission-denied', 'このアカウントは現在無効になっています。');
    }

    const room: Room = {
      type: 'group',
      name,
      ...(description ? { description } : {}),
      memberIds: [identity.memberId],
      memberCount: 1,
      createdAt: FieldValue.serverTimestamp(),
    };
    const creatorMember: RoomMember = { role: 'admin', joinedAt: FieldValue.serverTimestamp(), invitedBy: null };
    tx.set(roomRef, room);
    tx.set(roomRef.collection('members').doc(identity.memberId), creatorMember);
    tx.set(db().doc(threadPath(identity.tenantId, identity.memberId, roomRef.id)), newThread('group', name));

    return writeInvitations(
      tx,
      identity,
      roomRef.id,
      name,
      creator.displayName,
      inviteeSnaps.map((snap) => ({
        id: snap.id,
        member: snap.data() as Member | undefined,
        alreadyMember: false,
        pending: false,
      })),
    );
  });

  return { roomId: roomRef.id, invitedCount: invited.length };
});

/** グループのメンバーが、同一テナントの会員をグループに招待する。 */
export const inviteToGroup = onCall(async (request) => {
  const identity = requireFullMember(request.auth, 'グループへの招待');
  const data = (request.data ?? {}) as { roomId?: unknown; inviteeIds?: unknown };
  const roomId = typeof data.roomId === 'string' ? data.roomId : '';
  const inviteeIds = parseInviteeIds(data.inviteeIds, identity.memberId);
  if (!roomId || inviteeIds.length === 0) {
    throw new HttpsError('invalid-argument', '招待する会員を選んでください。');
  }

  const roomRef = db().doc(roomPath(identity.tenantId, roomId));

  const invited = await db().runTransaction(async (tx) => {
    const roomSnap = await tx.get(roomRef);
    const room = roomSnap.data() as Room | undefined;
    if (!room || room.type !== 'group') {
      throw new HttpsError('not-found', 'グループが見つかりません。');
    }
    if (!room.memberIds.includes(identity.memberId)) {
      throw new HttpsError('permission-denied', 'このグループのメンバーではありません。');
    }

    const [inviterSnap, pendingSnap, ...inviteeSnaps] = await Promise.all([
      tx.get(memberRef(identity.tenantId, identity.memberId)),
      tx.get(roomRef.collection('invitations').where('status', '==', 'pending')),
      ...inviteeIds.map((id) => tx.get(memberRef(identity.tenantId, id))),
    ]);
    const pendingIds = new Set(pendingSnap.docs.map((doc) => doc.id));

    const newInvitees = inviteeIds.filter((id) => !room.memberIds.includes(id) && !pendingIds.has(id));
    if (room.memberCount + pendingIds.size + newInvitees.length > GROUP_MEMBER_LIMIT) {
      throw new HttpsError(
        'failed-precondition',
        `グループの人数は${GROUP_MEMBER_LIMIT}人までです（招待中の人を含みます）。`,
      );
    }

    return writeInvitations(
      tx,
      identity,
      roomId,
      room.name ?? '',
      (inviterSnap.data() as Member | undefined)?.displayName ?? '会員',
      inviteeSnaps.map((snap) => ({
        id: snap.id,
        member: snap.data() as Member | undefined,
        alreadyMember: room.memberIds.includes(snap.id),
        pending: pendingIds.has(snap.id),
      })),
    );
  });

  return { invitedCount: invited.length };
});

/** 招待された会員が、グループへの招待に「参加する／断る」で答える。 */
export const respondToGroupInvitation = onCall(async (request) => {
  const identity = requireFullMember(request.auth, 'グループへの参加');
  const data = (request.data ?? {}) as { roomId?: unknown; accept?: unknown };
  const roomId = typeof data.roomId === 'string' ? data.roomId : '';
  if (!roomId || typeof data.accept !== 'boolean') {
    throw new HttpsError('invalid-argument', 'パラメータが不正です。');
  }
  const accept = data.accept;

  const roomRef = db().doc(roomPath(identity.tenantId, roomId));
  const invitationRef = roomRef.collection('invitations').doc(identity.memberId);
  const noticeRef = db().doc(groupInvitationNoticePath(identity.tenantId, identity.memberId, roomId));

  const expired = await db().runTransaction(async (tx) => {
    const [roomSnap, invitationSnap, latestSnap] = await Promise.all([
      tx.get(roomRef),
      tx.get(invitationRef),
      // 参加後のトーク一覧に、グループの最新メッセージを最初から出すため。
      tx.get(roomRef.collection('messages').orderBy('createdAt', 'desc').limit(1)),
    ]);
    const room = roomSnap.data() as Room | undefined;
    const invitation = invitationSnap.data() as RoomInvitation | undefined;
    const latest = latestSnap.docs[0]?.data() as RoomMessage | undefined;

    if (!room || !invitation || invitation.status !== 'pending') {
      // 招待が取り消された(グループが削除された)・既に答えた場合は、一覧に残った通知だけ片付ける。
      tx.delete(noticeRef);
      return true;
    }

    tx.update(invitationRef, {
      status: accept ? 'accepted' : 'declined',
      respondedAt: FieldValue.serverTimestamp(),
    });
    tx.delete(noticeRef);

    if (!accept || room.memberIds.includes(identity.memberId)) {
      return false;
    }
    if (room.memberCount >= GROUP_MEMBER_LIMIT) {
      throw new HttpsError('failed-precondition', `このグループは上限の${GROUP_MEMBER_LIMIT}人に達しています。`);
    }

    const roomMember: RoomMember = {
      role: 'member',
      joinedAt: FieldValue.serverTimestamp(),
      invitedBy: invitation.invitedBy,
    };
    tx.update(roomRef, {
      memberIds: FieldValue.arrayUnion(identity.memberId),
      memberCount: FieldValue.increment(1),
    });
    tx.set(roomRef.collection('members').doc(identity.memberId), roomMember);
    tx.set(db().doc(threadPath(identity.tenantId, identity.memberId, roomId)), {
      ...newThread('group', room.name ?? ''),
      // 参加前のメッセージは未読として数えない。
      ...(latest
        ? { lastMessageText: summarizeMessage(latest), lastSenderId: latest.senderId, lastMessageAt: latest.createdAt }
        : {}),
    });
    return false;
  });

  // expired: 招待が取り消されていた(グループが削除された・既に答えた)ため、何もしなかった。
  return { status: expired ? 'expired' : accept ? 'accepted' : 'declined' };
});

/** グループ管理者の一覧(トランザクション内で読む)。 */
async function getGroupAdminIds(
  tx: admin.firestore.Transaction,
  roomRef: admin.firestore.DocumentReference,
): Promise<string[]> {
  const snap = await tx.get(roomRef.collection('members').where('role', '==', 'admin'));
  return snap.docs.map((doc) => doc.id);
}

/**
 * グループ管理者が、メンバーをグループ管理者にする／グループ管理者から外す(自分自身も外せる)。
 * グループ管理者が1人もいなくなる変更はできない。
 */
export const setGroupAdmin = onCall(async (request) => {
  const identity = requireCallerIdentity(request.auth);
  const data = (request.data ?? {}) as { roomId?: unknown; memberId?: unknown; admin?: unknown };
  const roomId = typeof data.roomId === 'string' ? data.roomId : '';
  const memberId = typeof data.memberId === 'string' ? data.memberId : '';
  if (!roomId || !memberId || typeof data.admin !== 'boolean') {
    throw new HttpsError('invalid-argument', 'パラメータが不正です。');
  }
  const makeAdmin = data.admin;

  const roomRef = db().doc(roomPath(identity.tenantId, roomId));

  await db().runTransaction(async (tx) => {
    const roomSnap = await tx.get(roomRef);
    const room = roomSnap.data() as Room | undefined;
    if (!room || room.type !== 'group') {
      throw new HttpsError('not-found', 'グループが見つかりません。');
    }
    const adminIds = await getGroupAdminIds(tx, roomRef);
    if (!adminIds.includes(identity.memberId)) {
      throw new HttpsError('permission-denied', 'グループ管理者のみ操作できます。');
    }
    if (!room.memberIds.includes(memberId)) {
      throw new HttpsError('failed-precondition', 'このグループのメンバーではありません。');
    }
    if (!makeAdmin && adminIds.length === 1 && adminIds[0] === memberId) {
      throw new HttpsError('failed-precondition', 'グループ管理者が1人もいなくなるため、外せません。');
    }
    tx.update(roomRef.collection('members').doc(memberId), { role: makeAdmin ? 'admin' : 'member' });
  });

  return { role: makeAdmin ? 'admin' : 'member' };
});

/**
 * グループから退出する。グループ管理者は、他にグループ管理者がいる場合だけ退出できる
 * (先に他のメンバーをグループ管理者にしてもらう)。
 * 最後の1人が退出したときはグループを削除する(メッセージ・メンバー・招待・画像もすべて消し、保留中の招待は取り消す)。
 * 画面では、削除になることを事前に確認する。
 */
export const leaveGroup = onCall(async (request) => {
  const identity = requireCallerIdentity(request.auth);
  const { roomId } = (request.data ?? {}) as { roomId?: unknown };
  if (typeof roomId !== 'string' || !roomId) {
    throw new HttpsError('invalid-argument', 'パラメータが不正です。');
  }

  const roomRef = db().doc(roomPath(identity.tenantId, roomId));

  const deleted = await db().runTransaction(async (tx) => {
    const roomSnap = await tx.get(roomRef);
    const room = roomSnap.data() as Room | undefined;
    if (!room || room.type !== 'group') {
      throw new HttpsError('not-found', 'グループが見つかりません。');
    }
    if (!room.memberIds.includes(identity.memberId)) {
      throw new HttpsError('failed-precondition', 'このグループのメンバーではありません。');
    }

    const isLastMember = room.memberIds.length === 1;
    const [adminIds, pendingSnap] = await Promise.all([
      getGroupAdminIds(tx, roomRef),
      tx.get(roomRef.collection('invitations').where('status', '==', 'pending')),
    ]);
    if (!isLastMember && adminIds.includes(identity.memberId) && adminIds.length === 1) {
      throw new HttpsError(
        'failed-precondition',
        '他にグループ管理者がいないため退出できません。先に他のメンバーをグループ管理者にしてください。',
      );
    }

    tx.update(roomRef, {
      memberIds: FieldValue.arrayRemove(identity.memberId),
      memberCount: FieldValue.increment(-1),
    });
    tx.delete(roomRef.collection('members').doc(identity.memberId));
    tx.delete(db().doc(threadPath(identity.tenantId, identity.memberId, roomId)));

    if (isLastMember) {
      // 削除の途中で招待に「参加する」と答えても入れないよう、保留中の招待を先に取り消す。
      for (const invitation of pendingSnap.docs) {
        tx.update(invitation.ref, { status: 'canceled', respondedAt: FieldValue.serverTimestamp() });
        tx.delete(db().doc(groupInvitationNoticePath(identity.tenantId, invitation.id, roomId)));
      }
    }
    return isLastMember;
  });

  if (deleted) {
    // ルームとサブコレクション(メッセージ・メンバー・招待)、Storage の画像をまとめて削除する(トランザクションの外で行う)。
    await Promise.all([
      db().recursiveDelete(roomRef),
      admin.storage().bucket().deleteFiles({ prefix: `${roomPath(identity.tenantId, roomId)}/media/` }),
    ]);
  }

  return { left: true, deleted };
});
