import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import type { WebauthnChallenge } from './models';
import { CHALLENGE_TTL_MS, resolveRpID } from './webauthn';

/**
 * パスキーログインの最初のステップ。未ログイン状態から呼び出せる公開関数。
 * allowCredentialsを指定しないdiscoverable credential方式のため、
 * 電話番号やメールアドレスの入力なしにログインできる。
 */
export const startPasskeyAuthentication = onCall(async () => {
  const options = await generateAuthenticationOptions({
    rpID: resolveRpID(),
    userVerification: 'required',
  });

  const challenge: WebauthnChallenge = {
    type: 'authentication',
    challenge: options.challenge,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + CHALLENGE_TTL_MS),
  };
  const challengeRef = await admin.firestore().collection('webauthnChallenges').add(challenge);

  return { requestId: challengeRef.id, options };
});
