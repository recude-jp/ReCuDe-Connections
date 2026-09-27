import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { AdminService, MemberRow } from '../../core/services/admin.service';
import { CommunityRow, MemberService } from '../../core/services/member.service';
import { isFullMember, membershipLabel } from '../../core/utils/membership';
import { AdminScopeService } from '../../core/services/admin-scope.service';
import { MemberAvatar } from '../../shared/member-avatar/member-avatar';
import { profileSummary } from '../../core/utils/profile-fields';
import { formatDate, toMillis } from '../../core/utils/dates';

type RoleFilter = 'all' | 'admin' | 'recommender' | 'none';
type StatusFilter = 'all' | 'active' | 'suspended';
/** 会員の区分での絞り込み。community は連携コミュニティだけのメンバー。pending は会員申請の審査待ちの人。 */
type MembershipFilter = 'all' | 'member' | 'guest' | 'community' | 'pending';
type SortOrder = 'newest' | 'oldest';

/**
 * 管理画面の会員一覧(/admin/:scope/members)。名前検索、ロール・状態での絞り込み、登録日順の並べ替え。
 * 連携コミュニティでは、そのメンバーだけを出し、ロールはその連携コミュニティの管理者を表す。
 */
@Component({
  selector: 'app-admin-members',
  imports: [FormsModule, RouterLink, MemberAvatar],
  templateUrl: './admin-members.html',
  styleUrl: './admin-members.scss',
})
export class AdminMembers {
  private readonly auth = inject(AuthService);
  private readonly adminService = inject(AdminService);
  private readonly memberService = inject(MemberService);
  private readonly route = inject(ActivatedRoute);
  readonly scopes = inject(AdminScopeService);

  /** プロフィールの要約に使う、テナントのプロフィール項目。 */
  private readonly tenant = toSignal(
    this.auth.session$.pipe(
      switchMap((session) => (session?.kind === 'member' ? this.memberService.getTenant(session.tenantId) : of(undefined))),
    ),
  );

  readonly members = toSignal(
    this.auth.session$.pipe(
      switchMap((session) =>
        session?.kind === 'member' ? this.adminService.listMembers(session.tenantId) : of(undefined),
      ),
    ),
    { initialValue: undefined as MemberRow[] | undefined },
  );

  readonly communities = toSignal(
    this.auth.session$.pipe(
      switchMap((session) => (session?.kind === 'member' ? this.memberService.listCommunities(session.tenantId) : of([]))),
    ),
    { initialValue: [] as CommunityRow[] },
  );
  private readonly communityNames = computed(() => new Map(this.communities().map((c) => [c.id, c.name])));

  readonly nameQuery = signal('');
  /** 所属する連携コミュニティでの絞り込み(連携コミュニティの一覧の「参加者」から ?community= で開く)。 */
  readonly communityFilter = signal(this.route.snapshot.queryParamMap.get('community') ?? 'all');
  readonly roleFilter = signal<RoleFilter>('all');
  readonly statusFilter = signal<StatusFilter>('all');
  readonly membershipFilter = signal<MembershipFilter>('all');
  readonly sortOrder = signal<SortOrder>('newest');

  /** 推薦者(invitedBy)の表示名を引くための索引。 */
  private readonly namesById = computed(
    () => new Map((this.members() ?? []).map((member) => [member.id, member.displayName])),
  );

  readonly filteredMembers = computed(() => {
    const query = this.nameQuery().trim().toLowerCase();
    const role = this.roleFilter();
    const status = this.statusFilter();
    const membership = this.membershipFilter();
    const community = this.communityFilter();
    const scopeCommunity = this.scopes.community();
    const isCommunity = this.scopes.isCommunity();
    const direction = this.sortOrder() === 'newest' ? -1 : 1;

    if (isCommunity && !scopeCommunity) {
      return [];
    }
    return (this.members() ?? [])
      .filter((member) => !scopeCommunity || (member.communityIds ?? []).includes(scopeCommunity.id))
      .filter((member) => !query || member.displayName.toLowerCase().includes(query))
      .filter((member) => {
        const isAdmin = scopeCommunity ? scopeCommunity.adminIds.includes(member.id) : member.roles?.admin === true;
        switch (role) {
          case 'admin':
            return isAdmin;
          case 'recommender':
            return !scopeCommunity && member.roles?.recommender === true;
          case 'none':
            return !isAdmin && (!!scopeCommunity || !member.roles?.recommender);
          default:
            return true;
        }
      })
      .filter((member) => status === 'all' || (status === 'active') === member.isActive)
      .filter((member) => {
        switch (membership) {
          case 'member':
            return isFullMember(member);
          case 'guest':
          case 'community':
            return member.membership === membership;
          case 'pending':
            return !isFullMember(member) && member.membershipApplication?.status === 'pending';
          default:
            return true;
        }
      })
      .filter((member) => isCommunity || community === 'all' || (member.communityIds ?? []).includes(community))
      .sort((a, b) => direction * (toMillis(a.createdAt) - toMillis(b.createdAt)));
  });

  readonly formatDate = formatDate;
  readonly isFullMember = isFullMember;
  readonly membershipLabel = membershipLabel;

  /** 所属する連携コミュニティの名称。 */
  memberCommunityNames(member: MemberRow): string[] {
    return (member.communityIds ?? []).map((id) => this.communityNames().get(id) ?? '').filter(Boolean);
  }

  /** 対象のメンバーの数(絞り込む前)。 */
  readonly scopeTotal = computed(() => {
    const community = this.scopes.community();
    const members = this.members() ?? [];
    return community ? members.filter((m) => (m.communityIds ?? []).includes(community.id)).length : members.length;
  });

  /** 連携コミュニティの管理者か(連携コミュニティの一覧のとき)。 */
  isCommunityAdmin(member: MemberRow): boolean {
    return this.scopes.community()?.adminIds.includes(member.id) ?? false;
  }

  /** プロフィールの要約。連携コミュニティでは、その独自の項目を先に出す。 */
  profileText(member: MemberRow): string {
    const community = this.scopes.community();
    const own = community ? profileSummary(member.communityProfiles?.[community.id], community.profileFields, 2) : '';
    const root = profileSummary(member.profile, this.tenant()?.profileFields, 3);
    return [own, root].filter(Boolean).join(' ／ ');
  }

  recommenderName(member: MemberRow): string {
    if (!member.invitedBy) {
      return '';
    }
    return this.namesById().get(member.invitedBy) ?? '（不明）';
  }
}
