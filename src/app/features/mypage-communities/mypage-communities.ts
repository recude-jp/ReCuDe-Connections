import { Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { CommunityRow, MemberService } from '../../core/services/member.service';
import { MemberSearchService } from '../../core/services/member-search.service';
import { CommunityLogo } from '../../shared/community-logo/community-logo';
import { ProfileForm } from '../../shared/profile-form/profile-form';
import type { Member, ProfileValues } from '../../core/models/firestore.models';
import {
  formatProfileValue,
  missingRequiredFields,
  profileOptionCategory,
  visibleProfileFields,
} from '../../core/utils/profile-fields';
import { formatDate } from '../../core/utils/dates';
import { toErrorMessage } from '../../core/utils/errors';

/**
 * マイページの、所属する連携コミュニティごとのプロフィール(その連携コミュニティ独自の項目)と、参加の申請の状況。
 * 独自の項目の値は、その連携コミュニティの管理者の画面に出る。
 */
@Component({
  selector: 'app-mypage-communities',
  imports: [CommunityLogo, ProfileForm],
  templateUrl: './mypage-communities.html',
  styleUrl: './mypage-communities.scss',
})
export class MyPageCommunities {
  private readonly auth = inject(AuthService);
  private readonly memberService = inject(MemberService);
  private readonly searchService = inject(MemberSearchService);

  readonly member = input.required<Member>();

  private readonly communities = toSignal(
    this.auth.session$.pipe(
      switchMap((session) => (session?.kind === 'member' ? this.memberService.listCommunities(session.tenantId) : of([]))),
    ),
    { initialValue: [] as CommunityRow[] },
  );

  /** 所属する連携コミュニティ(名前順)。 */
  readonly joined = computed(() =>
    this.communities()
      .filter((c) => (this.member().communityIds ?? []).includes(c.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja')),
  );

  /** 審査待ち・否認された参加の申請。 */
  readonly applications = computed(() =>
    this.communities()
      .map((community) => ({ community, application: this.member().communityApplications?.[community.id] }))
      .filter(
        (row) =>
          !!row.application &&
          row.application.status !== 'approved' &&
          !(this.member().communityIds ?? []).includes(row.community.id),
      ),
  );

  readonly formatValue = formatProfileValue;
  readonly formatDate = formatDate;

  /** 編集中の連携コミュニティと、その入力。 */
  readonly editingId = signal<string | null>(null);
  readonly draft = signal<ProfileValues>({});
  readonly options = signal<Record<string, string[]>>({});
  readonly saving = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  fieldsOf(community: CommunityRow) {
    return visibleProfileFields(community.profileFields);
  }

  valuesOf(community: CommunityRow): ProfileValues {
    return this.member().communityProfiles?.[community.id] ?? {};
  }

  missing(community: CommunityRow): string[] {
    return missingRequiredFields(this.fieldsOf(community), this.draft());
  }

  async startEdit(community: CommunityRow): Promise<void> {
    this.errorMessage.set('');
    this.successMessage.set('');
    this.editingId.set(community.id);
    this.draft.set({ ...this.valuesOf(community) });
    const session = this.auth.currentSession;
    if (session?.kind !== 'member') {
      return;
    }
    const entries = await Promise.all(
      this.fieldsOf(community)
        .filter((field) => field.type === 'text' || field.type === 'tags')
        .map(
          async (field) =>
            [
              field.id,
              await this.searchService.getProfileOptions(session.tenantId, profileOptionCategory(field.id, community.id)),
            ] as const,
        ),
    );
    this.options.set(Object.fromEntries(entries));
  }

  async save(community: CommunityRow): Promise<void> {
    this.errorMessage.set('');
    this.saving.set(true);
    try {
      await this.memberService.updateCommunityProfile(community.id, this.draft());
      this.editingId.set(null);
      this.successMessage.set(`「${community.name}」のプロフィールを保存しました。`);
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
