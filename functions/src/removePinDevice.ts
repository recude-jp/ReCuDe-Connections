import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { requireCallerIdentity } from './callerIdentity';
import { pinDevicesCollectionPath } from './pin';
import type { PinDeviceIndexEntry } from './models';

/**
 * ログイン中の会員/事務局が自分のPINログイン端末を削除する。
 * 最後の1件を削除しても拒否しない(既存の電話番号OTP/メール・パスワードログインが必ず残るため)。
 */
export const removePinDevice = onCall(async (request) => {
  const identity = requireCallerIdentity(request.auth);

  const { deviceId } = (request.data ?? {}) as { deviceId?: string };
  if (!deviceId) {
    throw new HttpsError('invalid-argument', 'deviceIdを指定してください。');
  }

  const db = admin.firestore();
  const indexRef = db.doc(`pinDeviceIndex/${deviceId}`);
  const indexSnap = await indexRef.get();
  const indexEntry = indexSnap.data() as PinDeviceIndexEntry | undefined;

  if (!indexEntry || indexEntry.uid !== identity.uid) {
    throw new HttpsError('permission-denied', 'この端末を削除する権限がありません。');
  }

  await Promise.all([
    db.doc(`${pinDevicesCollectionPath(identity)}/${deviceId}`).delete(),
    indexRef.delete(),
  ]);

  return { deleted: true };
});
