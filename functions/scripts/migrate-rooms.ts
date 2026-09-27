/**
 * 1対1チャットをルーム方式へ移行するスクリプト(SPEC Step 2 の1.)。
 * つながり成立済み(accepted)のコネクションごとに、次を作る(何度実行しても同じ結果になる)。
 *   - 1対1のルーム tenants/[tenantId]/rooms/[connectionId] とメンバー、両者のトーク一覧(threads)
 *   - 旧メッセージ connections/[connectionId]/messages のコピー rooms/[connectionId]/messages(同じメッセージID)
 * 旧メッセージは削除しない(読み取り専用として残す)。トーク一覧の最新メッセージは、移行したメッセージから設定する。
 *
 * 実行:
 *   Emulator:  GCLOUD_PROJECT=demo-recude-match FIRESTORE_EMULATOR_HOST=localhost:8080 npm --prefix functions run migrate:rooms
 *   実環境:    GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json GCLOUD_PROJECT=<プロジェクトID> npm --prefix functions run migrate:rooms -- --yes
 */
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import type { Connection, Member, Message, RoomMessage } from '../src/models';
import { roomPath, summarizeMessage, threadPath, writeDirectRoom } from '../src/rooms';

const projectId = process.env.GCLOUD_PROJECT;
const useEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;

async function confirm(): Promise<void> {
  if (useEmulator || process.argv.includes('--yes')) {
    return;
  }
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`実環境 ${projectId} の1対1チャットをルームへ移行します。続行しますか？ [y/N] `);
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.log('中断しました。');
    process.exit(1);
  }
}

async function migrateConnection(
  db: admin.firestore.Firestore,
  tenantId: string,
  connectionId: string,
  connection: Connection,
): Promise<number> {
  const memberSnaps = await Promise.all(connection.memberIds.map((id) => db.doc(`tenants/${tenantId}/members/${id}`).get()));
  const roomRef = db.doc(roomPath(tenantId, connectionId));
  const roomExists = (await roomRef.get()).exists;

  // ルーム・メンバー・トーク一覧(まだ無い場合だけ作る。既にあれば既存の未読数などを残す)。
  if (!roomExists) {
    const batch = db.batch();
    writeDirectRoom(
      batch,
      tenantId,
      connectionId,
      memberSnaps.map((snap) => ({ id: snap.id, member: { displayName: (snap.data() as Member | undefined)?.displayName ?? '会員' } })),
    );
    await batch.commit();
  }

  // メッセージのコピー。threadsUpdated: true にして、onRoomMessageCreated で未読数を数えないようにする。
  const oldMessages = await db.collection(`tenants/${tenantId}/connections/${connectionId}/messages`).orderBy('createdAt', 'asc').get();
  for (let i = 0; i < oldMessages.docs.length; i += 400) {
    const batch = db.batch();
    for (const doc of oldMessages.docs.slice(i, i + 400)) {
      const old = doc.data() as Message;
      const message: RoomMessage = {
        senderId: old.senderId,
        type: old.type,
        ...(old.text !== undefined ? { text: old.text } : {}),
        ...(old.stamp !== undefined ? { stamp: old.stamp } : {}),
        status: 'ready',
        createdAt: old.createdAt,
        threadsUpdated: true,
      };
      batch.set(roomRef.collection('messages').doc(doc.id), message);
    }
    await batch.commit();
  }

  // トーク一覧の最新メッセージを、移行したメッセージの最後の1件に合わせる。
  const last = oldMessages.docs[oldMessages.docs.length - 1]?.data() as Message | undefined;
  if (last) {
    const lastAt = last.createdAt as Timestamp;
    const batch = db.batch();
    for (const memberId of connection.memberIds) {
      batch.set(
        db.doc(threadPath(tenantId, memberId, connectionId)),
        {
          lastMessageText: summarizeMessage({ ...last, status: 'ready' }),
          lastSenderId: last.senderId,
          lastMessageAt: lastAt,
          lastActivityAt: lastAt,
        },
        { merge: true },
      );
    }
    batch.update(roomRef, { lastMessageAt: lastAt });
    await batch.commit();
  }

  return oldMessages.size;
}

async function main(): Promise<void> {
  if (!projectId) {
    console.error('エラー: GCLOUD_PROJECT を指定してください。');
    process.exit(1);
  }
  if (!useEmulator && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('エラー: 実環境では GOOGLE_APPLICATION_CREDENTIALS を指定してください（Emulatorなら FIRESTORE_EMULATOR_HOST）。');
    process.exit(1);
  }
  await confirm();

  admin.initializeApp({ projectId });
  const db = admin.firestore();

  const tenants = await db.collection('tenants').get();
  for (const tenant of tenants.docs) {
    const connections = await tenant.ref.collection('connections').where('status', '==', 'accepted').get();
    let messageCount = 0;
    for (const doc of connections.docs) {
      messageCount += await migrateConnection(db, tenant.id, doc.id, doc.data() as Connection);
    }
    console.log(`${tenant.id}: 1対1ルーム ${connections.size}件、メッセージ ${messageCount}件を移行しました。`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
