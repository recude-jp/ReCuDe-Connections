import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import { AuthService, MemberSession } from '../../core/services/auth.service';
import { AdminService, MemberRow } from '../../core/services/admin.service';
import { MemberService } from '../../core/services/member.service';
import { MemberAvatar } from '../../shared/member-avatar/member-avatar';
import { AdminScopeService } from '../../core/services/admin-scope.service';
import { AdminCommunityMember } from '../admin-community-member/admin-community-member';
import { formatProfileValue } from '../../core/utils/profile-fields';
import { formatDate } from '../../core/utils/dates';
import { isFullMember, membershipLabel } from '../../core/utils/membership';
import { toErrorMessage } from '../../core/utils/errors';

/**
 * 管理画面の会員詳細(/admin/:scope/members/:memberId)。プロフィール全項目と電話番号を表示する。
 * ルートコミュニティでは、会員申請の審査、認定推薦者・管理者ロールの付与/剥奪、アカウントの停止/再開を行う。
 * 連携コミュニティでは、その連携コミュニティについての部分(AdminCommunityMember)を出す。
 * 最後の1人の管理者の剥奪・停止と自分自身の停止は、画面でも止め、サーバー側でも拒否する。
 */
@Component({
  selector: 'app-admin-member-detail',
  imports: [RouterLink, MemberAvatar, AdminCommunityMember],
  templateUrl: './admin-member-detail.html',
  styleUrl: './admin-member-detail.scss',
})
export class AdminMemberDetail {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly adminService = inject(AdminService);
  private readonly memberService = inject(MemberService);
  readonly scopes = inject(AdminScopeService);

  /** テナントのプロフィール項目(非表示の項目も、入力済みなら管理者には見せる)。 */
  private readonly tenant = toSignal(
    this.auth.session$.pipe(
      switchMap((session) => (session?.kind === 'member' ? this.memberService.getTenant(session.tenantId) : of(undefined))),
    ),
  );
  readonly profileFields = computed(() => this.tenant()?.profileFields ?? []);

  /** 非公開のプロフィールの値(生年月など)。読めるのはルートコミュニティの管理者だけ(firestore.rules)。 */
  private readonly privateValues = toSignal(
    this.auth.session$.pipe(
      switchMap((session) =>
        session?.kind === 'member' && session.isAdmin
          ? this.memberService.getPrivateProfile(session.tenantId, this.memberId)
          : of({} as Record<string, string | string[]>),
      ),
    ),
    { initialValue: {} as Record<string, string | string[]> },
  );

  /** 表示する値(公開の値と非公開の値)。 */
  valueOf(member: MemberRow, fieldId: string): string | string[] | undefined {
    return this.privateValues()[fieldId] ?? member.profile?.[fieldId];
  }
  readonly formatValue = formatProfileValue;
  readonly isFullMember = isFullMember;
  readonly membershipLabel = membershipLabel;

  private readonly communities = toSignal(
    this.auth.session$.pipe(
      switchMap((session) => (session?.kind === 'member' ? this.memberService.listCommunities(session.tenantId) : of([]))),
    ),
    { initialValue: [] },
  );
  /** この会員が所属する連携コミュニティ。 */
  readonly memberCommunities = computed(() => {
    const ids = this.member()?.communityIds ?? [];
    return this.communities().filter((community) => ids.includes(community.id));
  });

  readonly memberId = this.route.snapshot.paramMap.get('memberId') ?? '';

  readonly session = toSignal(this.auth.session$, { initialValue: undefined });
  readonly memberSession = computed(() => {
    const session = this.session();
    return session?.kind === 'member' ? (session as MemberSession) : null;
  });

  // 推薦者名の表示と「最後の管理者」判定のため、会員一覧もあわせて購読する。
  readonly members = toSignal(
    this.auth.session$.pipe(
      switchMap((session) =>
        session?.kind === 'member' ? this.adminService.listMembers(session.tenantId) : of(undefined),
      ),
    ),
    { initialValue: undefined as MemberRow[] | undefined },
  );

  readonly member = computed(() => this.members()?.find((m) => m.id === this.memberId));

  readonly recommenderName = computed(() => {
    const invitedBy = this.member()?.invitedBy;
    if (!invitedBy) {
      return '';
    }
    return this.members()?.find((m) => m.id === invitedBy)?.displayName ?? '（不明）';
  });

  readonly isSelf = computed(() => this.memberSession()?.memberId === this.memberId);

  /** この会員が、有効な管理者の最後の1人か。 */
  readonly isLastAdmin = computed(() => {
    const member = this.member();
    if (!member?.roles?.admin || !member.isActive) {
      return false;
    }
    const activeAdmins = (this.members() ?? []).filter((m) => m.roles?.admin && m.isActive);
    return activeAdmins.length <= 1;
  });

  /** 会員申請を否認するときの理由(申請した人に表示する)。 */
  readonly rejectReason = signal('');

  readonly processing = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  readonly formatDate = formatDate;

  /** ゲストの会員申請を承認・否認する。承認すると正規の会員になる。 */
  async decideMembership(member: MemberRow, approve: boolean): Promise<void> {
    const message = approve
      ? `${member.displayName}さんを正規の会員として承認します。\n\n会費の確認など、テナントの条件を満たしていることを確かめてから承認してください。よろしいですか？`
      : `${member.displayName}さんの会員申請を否認します。よろしいですか？`;
    if (!window.confirm(message)) {
      return;
    }
    const ok = await this.run(
      () => this.adminService.decideMembership(member.id, approve, this.rejectReason()),
      approve ? '正規の会員として承認しました。' : '会員申請を否認しました。',
    );
    if (ok) {
      this.rejectReason.set('');
    }
  }

  async toggleRecommender(member: MemberRow): Promise<void> {
    const next = !member.roles?.recommender;
    await this.run(
      () => this.adminService.setRoles(member.id, { recommender: next }),
      next ? '認定推薦者に任命しました。' : '認定推薦者を外しました。',
    );
  }

  async toggleAdmin(member: MemberRow): Promise<void> {
    const next = !member.roles?.admin;
    if (!next) {
      const target = this.isSelf() ? 'あなた自身' : `${member.displayName}さん`;
      if (!window.confirm(`${target}から管理者ロールを外します。よろしいですか？`)) {
        return;
      }
    }
    const ok = await this.run(
      () => this.adminService.setRoles(member.id, { admin: next }),
      next ? '管理者に任命しました。' : '管理者ロールを外しました。',
    );
    // 自分の管理者ロールを外した場合は、セッションに反映して管理画面から出る。
    if (ok && this.isSelf() && !next) {
      await this.auth.refreshSession();
      await this.router.navigate(['/mypage']);
    }
  }

  async toggleActive(member: MemberRow): Promise<void> {
    const next = !member.isActive;
    if (!next) {
      const message =
        `${member.displayName}さんのアカウントを停止します。\n\n` +
        '停止すると、この会員はログインできなくなり、ログイン中の端末も1時間以内に使えなくなります。' +
        'よろしいですか？';
      if (!window.confirm(message)) {
        return;
      }
    }
    await this.run(
      () => this.adminService.setStatus(member.id, next),
      next ? 'アカウントを再開しました。' : 'アカウントを停止しました。',
    );
  }

  private async run(action: () => Promise<void>, successMessage: string): Promise<boolean> {
    this.errorMessage.set('');
    this.successMessage.set('');
    this.processing.set(true);
    try {
      await action();
      this.successMessage.set(successMessage);
      return true;
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
      return false;
    } finally {
      this.processing.set(false);
    }
  }
}
