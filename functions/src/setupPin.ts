import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { requireCallerIdentity } from './callerIdentity';
import { PIN_REGEX, pinDevicesCollectionPath } from './pin';
import { hashSecret } from './hash';
import type { PinDevice, PinDeviceIndexEntry } from './models';

/**
 * ログイン中の会員/事務局が、この端末用のPINログインをセットアップする。
 * deviceIdはPINと組み合わさって初めて認証情報として機能する準機密値のため、
 * クライアントに返す以外(ログ等)には出力しない。
 */
export const setupPin = onCall({ concurrency: 1 }, async (request) => {
  const identity = requireCallerIdentity(request.auth);

  const { pin, deviceLabel } = (request.data ?? {}) as { pin?: string; deviceLabel?: string };
  if (!pin || !PIN_REGEX.test(pin)) {
    throw new HttpsError('invalid-argument', 'PINは6桁の数字で指定してください。');
  }

  const pinHash = await hashSecret(pin);

  const db = admin.firestore();
  const deviceRef = db.collection(pinDevicesCollectionPath(identity)).doc();
  const device: PinDevice = {
    pinHash,
    deviceLabel: deviceLabel?.trim() || 'この端末',
    failedAttempts: 0,
    lockedUntil: null,
    createdAt: FieldValue.serverTimestamp(),
    lastUsedAt: null,
  };
  const indexEntry: PinDeviceIndexEntry = {
    tenantId: identity.tenantId,
    kind: identity.kind,
    uid: identity.uid,
    memberId: identity.memberId,
  };

  await db.runTransaction(async (tx) => {
    tx.set(deviceRef, device);
    tx.set(db.doc(`pinDeviceIndex/${deviceRef.id}`), indexEntry);
  });

  return { deviceId: deviceRef.id };
});
