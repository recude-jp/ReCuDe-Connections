import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { AdminService, MemberRow } from '../../core/services/admin.service';
import { MemberService } from '../../core/services/member.service';
import { MemberAvatar } from '../../shared/member-avatar/member-avatar';
import { formatDate, toMillis } from '../../core/utils/dates';
import { profileSummary } from '../../core/utils/profile-fields';
import { isFullMember } from '../../core/utils/membership';
import { AdminScopeService } from '../../core/services/admin-scope.service';
import type { MembershipApplication } from '../../core/models/firestore.models';

/**
 * 管理画面の会員申請(/admin/:scope/applications)。審査待ちの申請を、古い順に出す。
 * ルートコミュニティはゲストからの正規の会員の申請、連携コミュニティは招待から参加した人の参加の申請
 * (参加に承認が必要な連携コミュニティ)。審査(承認・否認)は会員詳細で、プロフィールを確認してから行う。
 */
@Component({
  selector: 'app-admin-applications',
  imports: [RouterLink, MemberAvatar],
  templateUrl: './admin-applications.html',
  styleUrl: './admin-applications.scss',
})
export class AdminApplications {
  private readonly auth = inject(AuthService);
  private readonly adminService = inject(AdminService);
  private readonly memberService = inject(MemberService);
  readonly scopes = inject(AdminScopeService);

  readonly formatDate = formatDate;

  private readonly members = toSignal(
    this.auth.session$.pipe(
      switchMap((session) => (session?.kind === 'member' ? this.adminService.listMembers(session.tenantId) : of(undefined))),
    ),
  );

  private readonly tenant = toSignal(
    this.auth.session$.pipe(
      switchMap((session) => (session?.kind === 'member' ? this.memberService.getTenant(session.tenantId) : of(undefined))),
    ),
  );

  /** 対象のコミュニティへの申請(ルートは会員申請、連携コミュニティは参加の申請)。 */
  applicationOf(member: MemberRow): MembershipApplication | null {
    const community = this.scopes.community();
    if (community) {
      return member.communityApplications?.[community.id] ?? null;
    }
    return isFullMember(member) ? null : (member.membershipApplication ?? null);
  }

  readonly pending = computed(() => {
    const members = this.members();
    if (members === undefined || (this.scopes.isCommunity() && !this.scopes.community())) {
      return undefined;
    }
    return members
      .filter((m) => this.applicationOf(m)?.status === 'pending')
      .sort((a, b) => toMillis(this.applicationOf(a)!.submittedAt) - toMillis(this.applicationOf(b)!.submittedAt));
  });

  /** 招待した会員の名前。 */
  inviterName(member: MemberRow): string {
    return (member.invitedBy && this.members()?.find((m) => m.id === member.invitedBy)?.displayName) || '—';
  }

  profileText(member: MemberRow): string {
    return profileSummary(member.profile, this.tenant()?.profileFields, 3);
  }
}
