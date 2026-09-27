import { Component, computed, inject, input, signal } from '@angular/core';
import { AdminService, MemberRow } from '../../core/services/admin.service';
import type { CommunityRow } from '../../core/services/member.service';
import { formatProfileValue } from '../../core/utils/profile-fields';
import { formatDate } from '../../core/utils/dates';
import { isFullMember } from '../../core/utils/membership';
import { toErrorMessage } from '../../core/utils/errors';

/**
 * 連携コミュニティの管理画面の会員詳細(/admin/:communityId/members/:memberId)の、連携コミュニティについての部分。
 * 連携コミュニティ独自のプロフィール、参加の申請の審査、連携コミュニティの管理者の任命・解除、メンバーから外す操作。
 * (ルートコミュニティの会員詳細の、ロール・アカウントの停止などの操作は出さない。)
 */
@Component({
  selector: 'app-admin-community-member',
  templateUrl: './admin-community-member.html',
  styleUrl: '../admin-member-detail/admin-member-detail.scss',
})
export class AdminCommunityMember {
  private readonly adminService = inject(AdminService);

  readonly member = input.required<MemberRow>();
  readonly community = input.required<CommunityRow>();

  readonly formatDate = formatDate;
  readonly formatValue = formatProfileValue;

  readonly isMemberOfCommunity = computed(() => (this.member().communityIds ?? []).includes(this.community().id));
  readonly isCommunityAdmin = computed(() => this.community().adminIds.includes(this.member().id));
  readonly isLastAdmin = computed(() => this.isCommunityAdmin() && this.community().adminIds.length <= 1);
  readonly canBeAdmin = computed(() => this.member().isActive && isFullMember(this.member()));
  readonly application = computed(() => this.member().communityApplications?.[this.community().id] ?? null);
  readonly fields = computed(() => this.community().profileFields ?? []);
  readonly values = computed(() => this.member().communityProfiles?.[this.community().id] ?? {});

  readonly rejectReason = signal('');
  readonly processing = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  async decide(approve: boolean): Promise<void> {
    const { displayName } = this.member();
    const name = this.community().name;
    const message = approve
      ? `${displayName}さんを「${name}」のメンバーとして承認します。よろしいですか？`
      : `${displayName}さんの「${name}」への参加の申請を否認します。よろしいですか？`;
    if (!window.confirm(message)) {
      return;
    }
    const ok = await this.run(
      () => this.adminService.decideCommunityApplication(this.community().id, this.member().id, approve, this.rejectReason()),
      approve ? 'メンバーとして承認しました。' : '参加の申請を否認しました。',
    );
    if (ok) {
      this.rejectReason.set('');
    }
  }

  async toggleAdmin(): Promise<void> {
    const next = !this.isCommunityAdmin();
    if (!next && !window.confirm(`${this.member().displayName}さんを「${this.community().name}」の管理者から外します。よろしいですか？`)) {
      return;
    }
    await this.run(
      () => this.adminService.setCommunityAdmin(this.community().id, this.member().id, next),
      next ? '連携コミュニティの管理者に任命しました。' : '連携コミュニティの管理者から外しました。',
    );
  }

  async remove(): Promise<void> {
    const message =
      `${this.member().displayName}さんを「${this.community().name}」から外します。\n\n` +
      'この連携コミュニティのプロフィールの値も消えます。連携コミュニティだけに所属していた人は、ゲストに戻ります。よろしいですか？';
    if (!window.confirm(message)) {
      return;
    }
    await this.run(
      () => this.adminService.removeCommunityMember(this.community().id, this.member().id),
      '連携コミュニティから外しました。',
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
