import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { requireCallerIdentity } from './callerIdentity';
import { pinDevicesCollectionPath } from './pin';
import type { PinDevice } from './models';

export interface PinDeviceSummary {
  deviceId: string;
  deviceLabel: string;
  createdAt: string | null;
  lastUsedAt: string | null;
}

/** ログイン中の会員/事務局が登録済みのPINログイン端末一覧を取得する。pinHashは返さない。 */
export const listPinDevices = onCall(async (request) => {
  const identity = requireCallerIdentity(request.auth);

  const snap = await admin
    .firestore()
    .collection(pinDevicesCollectionPath(identity))
    .orderBy('createdAt')
    .get();

  const devices: PinDeviceSummary[] = snap.docs.map((doc) => {
    const data = doc.data() as PinDevice;
    return {
      deviceId: doc.id,
      deviceLabel: data.deviceLabel,
      createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : null,
      lastUsedAt: data.lastUsedAt instanceof Timestamp ? data.lastUsedAt.toDate().toISOString() : null,
    };
  });

  return { devices };
});
