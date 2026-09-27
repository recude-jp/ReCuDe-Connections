import { HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { requireAdmin, requireCallerIdentity } from './callerIdentity';
import type { CallerIdentity } from './callerIdentity';
import type { Community, CommunityScope, Member } from './models';

/**
 * 管理画面の対象のコミュニティ(ルートコミュニティ・連携コミュニティ)ごとの権限の確認。
 * - ルートコミュニティ: 管理者ロール(roles.admin)を持つ会員。
 * - 連携コミュニティ: その連携コミュニティの管理者(Community.adminIds)か、ルートコミュニティの管理者。
 * 管理画面の各機能の Cloud Functions は、ここで対象を確かめてから、ルート・連携コミュニティ共通の処理を行う。
 */

export interface ScopeAdmin {
  identity: CallerIdentity;
  member: Member;
  scope: CommunityScope;
  /** 連携コミュニティのとき。 */
  communityId?: string;
  community?: Community;
  communityRef?: FirebaseFirestore.DocumentReference;
}

/** 送られた対象を読む(未指定はルートコミュニティ)。 */
export function parseScope(raw: unknown): CommunityScope {
  const scope = (raw ?? { type: 'root' }) as Partial<CommunityScope>;
  if (scope.type === 'root') {
    return { type: 'root' };
  }
  if (scope.type === 'community' && typeof scope.communityId === 'string' && scope.communityId) {
    return { type: 'community', communityId: scope.communityId };
  }
  throw new HttpsError('invalid-argument', '対象のコミュニティが正しくありません。');
}

/** 対象のコミュニティの管理者からの呼び出しであることを確かめる。 */
export async function requireScopeAdmin(auth: CallableRequest['auth'], rawScope: unknown): Promise<ScopeAdmin> {
  const scope = parseScope(rawScope);
  if (scope.type === 'root') {
    const { identity, member } = await requireAdmin(auth);
    return { identity, member, scope };
  }
  const identity = requireCallerIdentity(auth);
  const db = admin.firestore();
  const communityId = scope.communityId!;
  const communityRef = db.doc(`tenants/${identity.tenantId}/communities/${communityId}`);
  const [memberSnap, communitySnap] = await Promise.all([
    db.doc(`tenants/${identity.tenantId}/members/${identity.memberId}`).get(),
    communityRef.get(),
  ]);
  const member = memberSnap.data() as Member | undefined;
  const community = communitySnap.data() as Community | undefined;
  if (!community) {
    throw new HttpsError('not-found', '連携コミュニティが見つかりません。');
  }
  const allowed =
    !!member &&
    member.isActive &&
    (member.roles?.admin === true || community.adminIds.includes(identity.memberId));
  if (!allowed) {
    throw new HttpsError('permission-denied', 'この連携コミュニティの管理者のみ操作できます。');
  }
  return { identity, member: member!, scope, communityId, community, communityRef };
}
