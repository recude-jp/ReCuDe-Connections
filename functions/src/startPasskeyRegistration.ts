import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { isoUint8Array } from '@simplewebauthn/server/helpers';
import type { Member, PasskeyCredential, WebauthnChallenge } from './models';
import { requireCallerIdentity } from './callerIdentity';
import {
  CHALLENGE_TTL_MS,
  credentialsCollectionPath,
  resolveRpID,
  webauthnRpName,
} from './webauthn';

/**
 * ログイン中の会員/事務局が新しいパスキーを登録する最初のステップ。
 * navigator.credentials.create()に渡すoptionsを生成し、チャレンジを一時保存する。
 */
export const startPasskeyRegistration = onCall(async (request) => {
  const identity = requireCallerIdentity(request.auth);

  const db = admin.firestore();
  const credentialsSnap = await db.collection(credentialsCollectionPath(identity)).get();
  const excludeCredentials = credentialsSnap.docs.map((doc) => {
    const data = doc.data() as PasskeyCredential;
    return { id: doc.id, transports: data.transports };
  });

  // OS/ブラウザ側のパスキー管理UI(Chromeのパスワードマネージャー、iCloudキーチェーン等)に
  // そのまま表示される値のため、Firestoreの内部ID(memberId等)ではなく利用者に意味のある値を使う。
  const memberSnap = await db.doc(`tenants/${identity.tenantId}/members/${identity.memberId}`).get();
  const memberData = memberSnap.data() as Member | undefined;
  const userName = memberData?.phoneNumber ?? identity.uid;
  const userDisplayName = memberData?.displayName ?? userName;

  const options = await generateRegistrationOptions({
    rpName: webauthnRpName.value(),
    rpID: resolveRpID(),
    userID: isoUint8Array.fromUTF8String(identity.uid),
    userName,
    userDisplayName,
    attestationType: 'none',
    excludeCredentials,
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });

  const challenge: WebauthnChallenge = {
    type: 'registration',
    challenge: options.challenge,
    uid: identity.uid,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + CHALLENGE_TTL_MS),
  };
  const challengeRef = await db.collection('webauthnChallenges').add(challenge);

  return { requestId: challengeRef.id, options };
});
