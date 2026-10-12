import type { Member, MembershipStatus } from '../models/firestore.models';

/**
 * ルートコミュニティの正規の会員か(区分が未設定なのは、ゲストの仕組みを入れる前からの正規の会員)。
 * functions/src/communities.ts の isFullMember と揃える。
 */
export function isFullMember(member: Pick<Member, 'membership'> | undefined | null): boolean {
  return !!member && (!member.membership || member.membership === 'member');
}

/**
 * 出会いを探すで見つけられ、コネクト申請し合えるか。正規の会員どうしと、同じ連携コミュニティに所属する人どうし
 * (連携コミュニティだけのメンバーを含む)。ゲストは対象外。functions/src/communities.ts の canDiscover と揃える。
 */
export function canDiscover(
  a: Pick<Member, 'membership' | 'communityIds'>,
  b: Pick<Member, 'membership' | 'communityIds'>,
): boolean {
  if (isFullMember(a) && isFullMember(b)) {
    return true;
  }
  if (a.membership === 'guest' || b.membership === 'guest') {
    return false;
  }
  const mine = new Set(a.communityIds ?? []);
  return (b.communityIds ?? []).some((id) => mine.has(id));
}

/** 会員の区分の表示名。 */
export function membershipLabel(membership: MembershipStatus | undefined): string {
  switch (membership) {
    case 'guest':
      return 'ゲスト';
    case 'community':
      return '連携コミュニティのみ';
    default:
      return '会員';
  }
}
