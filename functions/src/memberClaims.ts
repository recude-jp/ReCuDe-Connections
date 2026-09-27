import * as admin from 'firebase-admin';
import type { Member } from './models';

/** 会員のFirebase Authカスタムクレーム。Firestoreルール・Cloud Functions・クライアントの画面出し分けで使う。 */
export function buildMemberClaims(tenantId: string, memberId: string, member: Member): Record<string, unknown> {
  return {
    tenantId,
    memberId,
    isRecommender: member.roles?.recommender === true,
    isAdmin: member.roles?.admin === true,
    // ゲスト(招待されて参加し、まだ正規の会員でない人)。firestore.rules・Cloud Functions・画面の出し分けに使う。
    // 連携コミュニティだけのメンバー(community)も、ルートコミュニティの中ではゲストと同じ制限を受ける(SPEC 9章)。
    isGuest: member.membership === 'guest' || member.membership === 'community',
    // 会員の区分(画面の表示に使う。未設定は正規の会員)。
    membership: member.membership ?? 'member',
    // 所属する連携コミュニティ(招待先の選択・ロゴの表示に使う)。
    communityIds: member.communityIds ?? [],
    // 管理者になっている連携コミュニティ(管理画面に入れるか・対象の切り替えに使う)。
    adminCommunityIds: member.adminCommunityIds ?? [],
  };
}

/**
 * 管理者がロールや状態を変更した会員の、Firebase Authユーザーのカスタムクレームを更新する。
 * 会員ドキュメントはAuthのuidを持たないため電話番号で引く(パスキー・PINログインも同じuidを使う)。
 * まだ一度もログインしていない会員はAuthユーザーが無いので何もしない(初回ログイン時に設定される)。
 *
 * revokeTokens=true(アカウント停止時)は、発行済みのリフレッシュトークンも無効にする。
 */
export async function syncMemberClaims(
  tenantId: string,
  memberId: string,
  member: Member,
  options: { revokeTokens?: boolean } = {},
): Promise<void> {
  let user: admin.auth.UserRecord;
  try {
    user = await admin.auth().getUserByPhoneNumber(member.phoneNumber);
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/user-not-found') {
      return;
    }
    throw err;
  }

  await admin.auth().setCustomUserClaims(user.uid, buildMemberClaims(tenantId, memberId, member));
  if (options.revokeTokens) {
    await admin.auth().revokeRefreshTokens(user.uid);
  }
}
