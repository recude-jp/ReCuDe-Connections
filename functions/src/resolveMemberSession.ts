import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import type { Member, PhoneIndexEntry } from './models';
import { buildMemberClaims } from './memberClaims';

/**
 * 電話番号ログイン(Firebase Phone Auth)完了後にクライアントから呼び出す。
 * phoneIndex を引いて所属テナント・会員を特定し、カスタムクレームを設定する。
 */
export const resolveMemberSession = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'ログインが必要です。');
  }

  const phoneNumber = request.auth.token['phone_number'] as string | undefined;
  if (!phoneNumber) {
    throw new HttpsError('failed-precondition', '電話番号でのログインが必要です。');
  }

  const db = admin.firestore();
  const indexSnap = await db.doc(`phoneIndex/${phoneNumber}`).get();

  if (!indexSnap.exists) {
    throw new HttpsError(
      'not-found',
      'この電話番号は会員登録されていません。認定推薦者から招待を受けてください。',
    );
  }

  const { tenantId, memberId } = indexSnap.data() as PhoneIndexEntry;
  const memberSnap = await db.doc(`tenants/${tenantId}/members/${memberId}`).get();
  const member = memberSnap.data() as Member | undefined;

  if (!member || !member.isActive) {
    throw new HttpsError('permission-denied', 'このアカウントは現在無効になっています。');
  }

  await admin.auth().setCustomUserClaims(request.auth.uid, buildMemberClaims(tenantId, memberId, member));

  return {
    tenantId,
    memberId,
    displayName: member.displayName,
  };
});
