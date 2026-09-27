import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import type { PasskeyIndexEntry } from './models';
import { requireCallerIdentity } from './callerIdentity';
import { credentialsCollectionPath } from './webauthn';

/**
 * ログイン中の会員/事務局が自分のパスキーを削除する。
 * 最後の1件を削除しても拒否しない(既存の電話番号OTP/メール・パスワードログインが必ず残るため)。
 */
export const deletePasskeyCredential = onCall(async (request) => {
  const identity = requireCallerIdentity(request.auth);

  const { credentialId } = (request.data ?? {}) as { credentialId?: string };
  if (!credentialId) {
    throw new HttpsError('invalid-argument', 'credentialIdを指定してください。');
  }

  const db = admin.firestore();
  const indexRef = db.doc(`passkeyIndex/${credentialId}`);
  const indexSnap = await indexRef.get();
  const indexEntry = indexSnap.data() as PasskeyIndexEntry | undefined;

  if (!indexEntry || indexEntry.uid !== identity.uid) {
    throw new HttpsError('permission-denied', 'このパスキーを削除する権限がありません。');
  }

  await Promise.all([
    db.doc(`${credentialsCollectionPath(identity)}/${credentialId}`).delete(),
    indexRef.delete(),
  ]);

  return { deleted: true };
});
