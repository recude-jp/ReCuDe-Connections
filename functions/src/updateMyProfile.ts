import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { requireCallerIdentity } from './callerIdentity';
import {
  getPrivateValues,
  getProfileFields,
  sanitizeDisplayName,
  sanitizeIconText,
  sanitizeProfileValues,
  upsertProfileOptions,
  writePrivateValues,
} from './profile';
import { isFullMember } from './communities';
import type { Member, Room } from './models';
import { threadPath } from './rooms';

/**
 * 会員が自分のプロフィール(名前・プロフィール画像・アイコンの文字・テナントのプロフィール項目)を更新する。
 * 会員ドキュメントはクライアントから直接書けない(firestore.rules)ため、この関数で項目を検査してから書く。
 *
 * プロフィール画像は、クライアントが Storage の自分の置き場(tenants/[tenantId]/members/[memberId]/photo/)に
 * 先に上げてからパスを渡す。null を渡すと画像を外す。差し替え・外したときは古い画像を消す。
 */
export const updateMyProfile = onCall(async (request) => {
  const identity = requireCallerIdentity(request.auth);
  const data = (request.data ?? {}) as { displayName?: unknown; profile?: unknown; photoPath?: unknown; avatarText?: unknown };
  // 省くと変えない。空文字で未設定に戻す。
  const avatarText = data.avatarText === undefined ? undefined : sanitizeIconText(data.avatarText);

  const db = admin.firestore();
  const memberRef = db.doc(`tenants/${identity.tenantId}/members/${identity.memberId}`);
  const [memberSnap, fields] = await Promise.all([memberRef.get(), getProfileFields(identity.tenantId)]);
  const member = memberSnap.data() as Member | undefined;
  if (!member || !member.isActive) {
    throw new HttpsError('permission-denied', 'このアカウントは現在無効になっています。');
  }

  const displayName = sanitizeDisplayName(data.displayName);
  // ゲストのプロフィール項目は「会員登録」(applyForMembership)で入力するため、ここでは名前・画像だけを変える。
  const isGuest = !isFullMember(member);
  const { publicValues: profile, privateValues } = isGuest
    ? { publicValues: member.profile ?? {}, privateValues: null }
    : sanitizeProfileValues(fields, data.profile, {
        publicValues: member.profile ?? {},
        privateValues: await getPrivateValues(identity.tenantId, identity.memberId),
      });

  const photoPrefix = `tenants/${identity.tenantId}/members/${identity.memberId}/photo/`;
  let photoPath: string | null | undefined;
  if (data.photoPath === null) {
    photoPath = null;
  } else if (typeof data.photoPath === 'string' && data.photoPath !== member.photoPath) {
    if (!data.photoPath.startsWith(photoPrefix) || data.photoPath.slice(photoPrefix.length).includes('/')) {
      throw new HttpsError('invalid-argument', 'プロフィール画像の指定が正しくありません。');
    }
    const [exists] = await admin.storage().bucket().file(data.photoPath).exists();
    if (!exists) {
      throw new HttpsError('failed-precondition', 'プロフィール画像のアップロードが完了していません。');
    }
    photoPath = data.photoPath;
  }

  const writeBatch = db.batch();
  writeBatch.update(memberRef, {
    displayName,
    profile,
    ...(photoPath === null ? { photoPath: FieldValue.delete() } : photoPath ? { photoPath } : {}),
    ...(avatarText === undefined ? {} : { avatarText: avatarText || FieldValue.delete() }),
  });
  // 非公開の値(生年月など)は会員データとは別に保存する。
  if (privateValues) {
    writePrivateValues(writeBatch, identity.tenantId, identity.memberId, privateValues);
  }
  await writeBatch.commit();

  // 差し替えた・外した古い画像を消す(失敗しても更新自体は成功とする)。
  if (photoPath !== undefined && member.photoPath) {
    await admin.storage().bucket().file(member.photoPath).delete().catch(() => undefined);
  }
  await upsertProfileOptions(identity.tenantId, fields, profile);

  // 名前を変えたときは、1対1のトークの相手側の一覧に出ている名前(Thread.title)も変える。
  if (displayName !== member.displayName) {
    const roomsSnap = await db
      .collection(`tenants/${identity.tenantId}/rooms`)
      .where('memberIds', 'array-contains', identity.memberId)
      .get();
    const batch = db.batch();
    for (const roomDoc of roomsSnap.docs) {
      const room = roomDoc.data() as Room;
      if (room.type !== 'direct') {
        continue;
      }
      for (const otherId of room.memberIds.filter((id) => id !== identity.memberId)) {
        batch.set(db.doc(threadPath(identity.tenantId, otherId, roomDoc.id)), { title: displayName }, { merge: true });
      }
    }
    await batch.commit();
  }

  return { displayName, profile, photoPath: photoPath === undefined ? member.photoPath ?? null : photoPath };
});
