import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Room, RoomMessage } from './models';
import { roomPath, summarizeMessage, threadPath } from './rooms';

/** ルームの lastMessageAt を更新する最短間隔(1ドキュメントへの書き込み集中を避けるため間引く。SPEC 5-7)。 */
const ROOM_LAST_MESSAGE_UPDATE_INTERVAL_MS = 60 * 1000;

/**
 * ルームにメッセージが作られたら、メンバー全員のトーク一覧(threads)に最新メッセージを反映し、
 * 送信者以外の未読数を1増やす(SPEC 5-7)。ルームの lastMessageAt は間引いて更新する。
 *
 * トリガーは再実行されることがあるため、メッセージの threadsUpdated で反映済みかを判定し、
 * 反映とフラグの書き込みを同じトランザクションで行う(未読数を二重に数えないため)。
 */
export const onRoomMessageCreated = onDocumentCreated(
  {
    document: 'tenants/{tenantId}/rooms/{roomId}/messages/{messageId}',
    // Firestore のトリガーは、データベースと同じリージョンに置く必要がある(データベースは asia-northeast1)。
    // 呼び出し型の関数(onCall)は、クライアントの既定に合わせて us-central1 のまま。
    region: 'asia-northeast1',
  },
  async (event) => {
    const { tenantId, roomId } = event.params;
    const messageRef = event.data?.ref;
    if (!messageRef) {
      return;
    }

    const db = admin.firestore();
    const roomRef = db.doc(roomPath(tenantId, roomId));

    await db.runTransaction(async (tx) => {
      const [messageSnap, roomSnap] = await Promise.all([tx.get(messageRef), tx.get(roomRef)]);
      const message = messageSnap.data() as RoomMessage | undefined;
      const room = roomSnap.data() as Room | undefined;
      if (!message || message.threadsUpdated || !room) {
        return;
      }

      const createdAt =
        message.createdAt instanceof Timestamp ? message.createdAt : FieldValue.serverTimestamp();
      const summary = summarizeMessage(message);

      for (const memberId of room.memberIds) {
        const isSender = memberId === message.senderId;
        tx.set(
          db.doc(threadPath(tenantId, memberId, roomId)),
          {
            lastMessageText: summary,
            lastSenderId: message.senderId,
            lastMessageAt: createdAt,
            lastActivityAt: createdAt,
            // 自分が送ったメッセージは既読として扱う。
            ...(isSender ? { unreadCount: 0, lastReadAt: createdAt } : { unreadCount: FieldValue.increment(1) }),
          },
          { merge: true },
        );
      }
      const lastMessageAt = room.lastMessageAt instanceof Timestamp ? room.lastMessageAt.toMillis() : 0;
      if (Date.now() - lastMessageAt >= ROOM_LAST_MESSAGE_UPDATE_INTERVAL_MS) {
        tx.update(roomRef, { lastMessageAt: createdAt });
      }
      tx.update(messageRef, { threadsUpdated: true });
    });
  },
);
