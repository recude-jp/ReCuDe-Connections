import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import type { PasskeyCredential, PasskeyIndexEntry, WebauthnChallenge } from './models';
import { requireCallerIdentity } from './callerIdentity';
import { credentialsCollectionPath, resolveOrigin, resolveRpID } from './webauthn';

/**
 * startPasskeyRegistrationで発行したチャレンジに対する認証器からの応答を検証し、
 * 検証に成功したパスキーをFirestoreへ登録する。
 */
export const completePasskeyRegistration = onCall(async (request) => {
  const identity = requireCallerIdentity(request.auth);

  const { requestId, credential, deviceLabel } = (request.data ?? {}) as {
    requestId?: string;
    credential?: RegistrationResponseJSON;
    deviceLabel?: string;
  };
  if (!requestId || !credential) {
    throw new HttpsError('invalid-argument', 'リクエストが不正です。');
  }

  const db = admin.firestore();
  const challengeRef = db.doc(`webauthnChallenges/${requestId}`);
  const challengeSnap = await challengeRef.get();
  const challengeData = challengeSnap.data() as WebauthnChallenge | undefined;

  if (
    !challengeData ||
    challengeData.type !== 'registration' ||
    challengeData.uid !== identity.uid ||
    challengeData.expiresAt.toMillis() < Date.now()
  ) {
    throw new HttpsError('failed-precondition', '登録セッションの有効期限が切れています。もう一度お試しください。');
  }

  const verification = await verifyRegistrationResponse({
    response: credential,
    expectedChallenge: challengeData.challenge,
    expectedOrigin: resolveOrigin(),
    expectedRPID: resolveRpID(),
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new HttpsError('invalid-argument', 'パスキーの検証に失敗しました。');
  }

  const { credential: verifiedCredential, credentialBackedUp } = verification.registrationInfo;

  const passkey: PasskeyCredential = {
    publicKey: isoBase64URL.fromBuffer(verifiedCredential.publicKey),
    counter: verifiedCredential.counter,
    transports: verifiedCredential.transports,
    deviceLabel: deviceLabel?.trim() || '登録済みのパスキー',
    backedUp: credentialBackedUp,
    createdAt: FieldValue.serverTimestamp(),
    lastUsedAt: null,
  };
  const indexEntry: PasskeyIndexEntry = {
    tenantId: identity.tenantId,
    kind: identity.kind,
    uid: identity.uid,
    memberId: identity.memberId,
  };

  await db.runTransaction(async (tx) => {
    tx.set(db.doc(`${credentialsCollectionPath(identity)}/${verifiedCredential.id}`), passkey);
    tx.set(db.doc(`passkeyIndex/${verifiedCredential.id}`), indexEntry);
    tx.delete(challengeRef);
  });

  return { credentialId: verifiedCredential.id, deviceLabel: passkey.deviceLabel };
});
