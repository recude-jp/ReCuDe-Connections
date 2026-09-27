import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import type { Member, RoomMessage, Room, RoomMember, Thread } from './models';

/** グループの人数上限(SPEC 5-2)。 */
export const GROUP_MEMBER_LIMIT = 50;

/** グループ名・説明の長さの上限。 */
export const GROUP_NAME_MAX_LENGTH = 40;
export const GROUP_DESCRIPTION_MAX_LENGTH = 200;

export function roomPath(tenantId: string, roomId: string): string {
  return `tenants/${tenantId}/rooms/${roomId}`;
}

export function threadPath(tenantId: string, memberId: string, roomId: string): string {
  return `tenants/${tenantId}/members/${memberId}/threads/${roomId}`;
}

export function groupInvitationNoticePath(tenantId: string, memberId: string, roomId: string): string {
  return `tenants/${tenantId}/members/${memberId}/groupInvitations/${roomId}`;
}

/** ルームに入ったときに作るトーク一覧の行(まだメッセージがない状態)。 */
export function newThread(
  roomType: Room['type'],
  title: string,
  extra: Partial<Pick<Thread, 'otherMemberId'>> = {},
): Thread {
  return {
    roomType,
    title,
    ...extra,
    lastMessageText: '',
    lastSenderId: null,
    lastMessageAt: null,
    lastActivityAt: FieldValue.serverTimestamp(),
    unreadCount: 0,
    lastReadAt: null,
  };
}

/** トーク一覧に出す最新メッセージの要約。 */
export function summarizeMessage(message: Pick<RoomMessage, 'type' | 'text' | 'status'>): string {
  if (message.status === 'removed') {
    return '（削除されたメッセージ）';
  }
  if (message.type === 'stamp') {
    return 'スタンプ';
  }
  if (message.type === 'image') {
    return '写真';
  }
  const text = (message.text ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

/**
 * つながり(Connection)の成立時に、1対1のルーム・メンバー・両者のトーク一覧を作る。
 * roomIdはConnectionのIDと同じ値にする(SPEC 5-1)。移行スクリプト(scripts/migrate-rooms.ts)と共用する。
 */
export function writeDirectRoom(
  writer: admin.firestore.Transaction | admin.firestore.WriteBatch,
  tenantId: string,
  connectionId: string,
  members: { id: string; member: Pick<Member, 'displayName'> }[],
): void {
  const db = admin.firestore();
  const [a, b] = members;
  const room: Room = {
    type: 'direct',
    memberIds: [a.id, b.id],
    memberCount: 2,
    connectionId,
    createdAt: FieldValue.serverTimestamp(),
  };
  const roomRef = db.doc(roomPath(tenantId, connectionId));
  const roomMember: RoomMember = { role: 'member', joinedAt: FieldValue.serverTimestamp(), invitedBy: null };

  // Transaction と WriteBatch はどちらも set(ref, data) を持つ。
  const set = (ref: admin.firestore.DocumentReference, data: object) =>
    (writer as admin.firestore.WriteBatch).set(ref, data);

  set(roomRef, room);
  for (const self of [a, b]) {
    const other = self === a ? b : a;
    set(roomRef.collection('members').doc(self.id), roomMember);
    set(db.doc(threadPath(tenantId, self.id, connectionId)), newThread('direct', other.member.displayName, { otherMemberId: other.id }));
  }
}
