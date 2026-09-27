import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import type { PasskeyCredential } from './models';
import { requireCallerIdentity } from './callerIdentity';
import { credentialsCollectionPath } from './webauthn';

export interface PasskeyCredentialSummary {
  credentialId: string;
  deviceLabel: string;
  backedUp: boolean;
  createdAt: string | null;
  lastUsedAt: string | null;
}

/** ログイン中の会員/事務局が登録済みのパスキー一覧を取得する。publicKey/counterは返さない。 */
export const listPasskeyCredentials = onCall(async (request) => {
  const identity = requireCallerIdentity(request.auth);

  const snap = await admin
    .firestore()
    .collection(credentialsCollectionPath(identity))
    .orderBy('createdAt')
    .get();

  const credentials: PasskeyCredentialSummary[] = snap.docs.map((doc) => {
    const data = doc.data() as PasskeyCredential;
    return {
      credentialId: doc.id,
      deviceLabel: data.deviceLabel,
      backedUp: data.backedUp,
      createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : null,
      lastUsedAt: data.lastUsedAt instanceof Timestamp ? data.lastUsedAt.toDate().toISOString() : null,
    };
  });

  return { credentials };
});
