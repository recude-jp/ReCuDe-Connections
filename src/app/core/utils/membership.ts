import type { Member, MembershipStatus } from '../models/firestore.models';

/**
 * ルートコミュニティの正規の会員か(区分が未設定なのは、ゲストの仕組みを入れる前からの正規の会員)。
 * functions/src/communities.ts の isFullMember と揃える。
 */
export function isFullMember(member: Pick<Member, 'membership'> | undefined | null): boolean {
  return !!member && (!member.membership || member.membership === 'member');
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
