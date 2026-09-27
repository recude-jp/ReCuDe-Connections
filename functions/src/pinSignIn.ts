import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { PIN_LOCKOUT_MS, PIN_MAX_ATTEMPTS, pinDevicesCollectionPath } from './pin';
import { verifySecret } from './hash';
import type { Member, PinDevice, PinDeviceIndexEntry } from './models';
import { MemberRef, memberRefFromIndex } from './callerIdentity';
import { buildMemberClaims } from './memberClaims';

type SignInOutcome =
  | { status: 'not-found' }
  | { status: 'locked' }
  | { status: 'invalid' }
  | { status: 'success' };

/**
 * PINログインの完了ステップ。未ログイン状態から呼び出せる公開関数。
 * deviceId(この端末で事前にsetupPinしたことがある証拠)とPINの2要素が揃って
 * 初めてログインできる(PINだけでは世界中のどこからでもログインできない設計)。
 *
 * ロック判定・PIN検証・失敗回数の更新はdb.runTransaction内で行うが、
 * トランザクション内でHttpsErrorをthrowすると書き込み(カウンタ更新)自体が
 * ロールバックされてしまうため、判定結果を返り値として受け取り、
 * トランザクションの外でエラーをthrowする。
 */
export const pinSignIn = onCall({ concurrency: 1 }, async (request) => {
  const { deviceId, pin } = (request.data ?? {}) as { deviceId?: string; pin?: string };
  if (!deviceId || !pin) {
    throw new HttpsError('invalid-argument', 'リクエストが不正です。');
  }

  const db = admin.firestore();
  const indexSnap = await db.doc(`pinDeviceIndex/${deviceId}`).get();
  const indexEntry = indexSnap.data() as PinDeviceIndexEntry | undefined;
  const memberRef: MemberRef | null = indexEntry ? memberRefFromIndex(indexEntry) : null;
  if (!indexEntry || !memberRef) {
    throw new HttpsError('not-found', 'この端末は登録されていません。');
  }

  const deviceRef = db.doc(`${pinDevicesCollectionPath(memberRef)}/${deviceId}`);

  const outcome: SignInOutcome = await db.runTransaction(async (tx) => {
    const deviceSnap = await tx.get(deviceRef);
    const device = deviceSnap.data() as PinDevice | undefined;
    if (!device) {
      return { status: 'not-found' };
    }

    const now = Date.now();
    const isLocked = device.lockedUntil !== null && device.lockedUntil.toMillis() > now;
    if (isLocked) {
      return { status: 'locked' };
    }
    // ロック期限切れ(または未ロック)の場合、この試行を数える前にリセットしてから判定する。
    const failedAttempts = device.lockedUntil !== null ? 0 : device.failedAttempts;

    const verified = await verifySecret(pin, device.pinHash);
    if (!verified) {
      const nextAttempts = failedAttempts + 1;
      const willLock = nextAttempts >= PIN_MAX_ATTEMPTS;
      tx.update(deviceRef, {
        failedAttempts: willLock ? 0 : nextAttempts,
        lockedUntil: willLock ? Timestamp.fromMillis(now + PIN_LOCKOUT_MS) : null,
      });
      return { status: willLock ? 'locked' : 'invalid' };
    }

    tx.update(deviceRef, {
      failedAttempts: 0,
      lockedUntil: null,
      lastUsedAt: FieldValue.serverTimestamp(),
    });
    return { status: 'success' };
  });

  if (outcome.status === 'not-found') {
    throw new HttpsError('not-found', 'この端末は登録されていません。');
  }
  if (outcome.status === 'locked') {
    throw new HttpsError('resource-exhausted', '試行回数の上限に達しました。しばらくしてから再度お試しください。');
  }
  if (outcome.status === 'invalid') {
    throw new HttpsError('permission-denied', 'PINが正しくありません。');
  }

  const memberSnap = await db.doc(`tenants/${memberRef.tenantId}/members/${memberRef.memberId}`).get();
  const member = memberSnap.data() as Member | undefined;
  if (!member || !member.isActive) {
    throw new HttpsError('permission-denied', 'このアカウントは現在無効になっています。');
  }

  // 管理者によるロール変更を反映するため、トークン発行前にカスタムクレームを会員ドキュメントから再設定する。
  await admin.auth().setCustomUserClaims(
    indexEntry.uid,
    buildMemberClaims(memberRef.tenantId, memberRef.memberId, member),
  );
  const customToken = await admin.auth().createCustomToken(indexEntry.uid);
  return { customToken };
});
