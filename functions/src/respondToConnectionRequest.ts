import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import type { Connection, Member } from './models';
import { writeDirectRoom } from './rooms';

/**
 * コネクト申請を受けた側が承認または却下する。申請した本人は応答できない。
 * 承認したときは、同じトランザクションで1対1のトークルーム(roomId = connectionId)を作る。
 */
export const respondToConnectionRequest = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'ログインが必要です。');
  }

  const tenantId = request.auth.token['tenantId'] as string | undefined;
  const memberId = request.auth.token['memberId'] as string | undefined;
  if (!tenantId || !memberId) {
    throw new HttpsError('permission-denied', '会員のみ操作できます。');
  }

  const { connectionId, accept } = (request.data ?? {}) as { connectionId?: string; accept?: boolean };
  if (!connectionId || typeof accept !== 'boolean') {
    throw new HttpsError('invalid-argument', 'パラメータが不正です。');
  }

  const db = admin.firestore();
  const connectionRef = db.doc(`tenants/${tenantId}/connections/${connectionId}`);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(connectionRef);
    const connection = snap.data() as Connection | undefined;

    if (!connection) {
      throw new HttpsError('not-found', 'コネクト申請が見つかりません。');
    }
    if (!connection.memberIds.includes(memberId)) {
      throw new HttpsError('permission-denied', '自分に関係のない申請です。');
    }
    if (connection.requestedBy === memberId) {
      throw new HttpsError('permission-denied', '自分が送った申請には応答できません。');
    }
    if (connection.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'この申請はすでに処理済みです。');
    }

    // トーク一覧に相手の表示名を出すため、両者のプロフィールを読む(トランザクション内の読み取りは書き込みより前に行う)。
    const memberSnaps = accept
      ? await Promise.all(
          connection.memberIds.map((id) => tx.get(db.doc(`tenants/${tenantId}/members/${id}`))),
        )
      : [];

    tx.update(connectionRef, {
      status: accept ? 'accepted' : 'declined',
      respondedAt: FieldValue.serverTimestamp(),
    });

    if (accept) {
      writeDirectRoom(
        tx,
        tenantId,
        connectionId,
        memberSnaps.map((memberSnap) => ({
          id: memberSnap.id,
          member: { displayName: (memberSnap.data() as Member | undefined)?.displayName ?? '会員' },
        })),
      );
    }
  });

  return { status: accept ? 'accepted' : 'declined' };
});
