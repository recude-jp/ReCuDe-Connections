import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { Member, PasskeyCredential, PasskeyIndexEntry, WebauthnChallenge } from './models';
import { credentialsCollectionPath, resolveOrigin, resolveRpID } from './webauthn';
import { memberRefFromIndex } from './callerIdentity';
import { buildMemberClaims } from './memberClaims';

/**
 * パスキーログインの完了ステップ。認証器の応答を検証し、成功したらFirebase Authの
 * カスタムトークンを発行する。カスタムクレーム(tenantId/memberId/isAdmin等)は
 * Firebase Authユーザーに永続化されているが、管理者によるロール変更を反映するため
 * トークン発行前に会員ドキュメントから再設定する。
 */
export const completePasskeyAuthentication = onCall(async (request) => {
  const { requestId, credential } = (request.data ?? {}) as {
    requestId?: string;
    credential?: AuthenticationResponseJSON;
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
    challengeData.type !== 'authentication' ||
    challengeData.expiresAt.toMillis() < Date.now()
  ) {
    throw new HttpsError('failed-precondition', 'ログインセッションの有効期限が切れています。もう一度お試しください。');
  }

  const indexSnap = await db.doc(`passkeyIndex/${credential.id}`).get();
  const indexEntry = indexSnap.data() as PasskeyIndexEntry | undefined;
  const memberRef = indexEntry ? memberRefFromIndex(indexEntry) : null;
  if (!indexEntry || !memberRef) {
    throw new HttpsError('not-found', 'このパスキーは登録されていません。');
  }

  const credentialRef = db.doc(`${credentialsCollectionPath(memberRef)}/${credential.id}`);
  const credentialSnap = await credentialRef.get();
  const storedCredential = credentialSnap.data() as PasskeyCredential | undefined;
  if (!storedCredential) {
    throw new HttpsError('not-found', 'このパスキーは登録されていません。');
  }

  const verification = await verifyAuthenticationResponse({
    response: credential,
    expectedChallenge: challengeData.challenge,
    expectedOrigin: resolveOrigin(),
    expectedRPID: resolveRpID(),
    credential: {
      id: credential.id,
      publicKey: isoBase64URL.toBuffer(storedCredential.publicKey),
      counter: storedCredential.counter,
      transports: storedCredential.transports,
    },
  });

  if (!verification.verified) {
    throw new HttpsError('permission-denied', 'ログインに失敗しました。');
  }

  const memberSnap = await db.doc(`tenants/${memberRef.tenantId}/members/${memberRef.memberId}`).get();
  const member = memberSnap.data() as Member | undefined;
  if (!member || !member.isActive) {
    throw new HttpsError('permission-denied', 'このアカウントは現在無効になっています。');
  }

  await Promise.all([
    admin.auth().setCustomUserClaims(indexEntry.uid, buildMemberClaims(memberRef.tenantId, memberRef.memberId, member)),
    credentialRef.update({
      counter: verification.authenticationInfo.newCounter,
      lastUsedAt: FieldValue.serverTimestamp(),
    }),
    challengeRef.delete(),
  ]);

  const customToken = await admin.auth().createCustomToken(indexEntry.uid);

  return { customToken, credentialId: credential.id };
});
