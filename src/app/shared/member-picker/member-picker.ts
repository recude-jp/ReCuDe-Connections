import { Component, computed, inject, input, model, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import type { Member } from '../../core/models/firestore.models';
import { AuthService } from '../../core/services/auth.service';
import { MemberService } from '../../core/services/member.service';
import { profileSummary } from '../../core/utils/profile-fields';
import { MemberAvatar } from '../member-avatar/member-avatar';

type PickableMember = Member & { id: string };

/** グループの作成・招待で、同じテナントの会員を複数選ぶための一覧(名前で絞り込める)。 */
@Component({
  selector: 'app-member-picker',
  imports: [MemberAvatar],
  templateUrl: './member-picker.html',
  styleUrl: './member-picker.scss',
})
export class MemberPicker {
  private readonly auth = inject(AuthService);
  private readonly memberService = inject(MemberService);

  /** 候補の横に出すプロフィールの要約に使う、テナントのプロフィール項目。 */
  private readonly tenant = toSignal(
    this.auth.session$.pipe(
      switchMap((session) => (session?.kind === 'member' ? this.memberService.getTenant(session.tenantId) : of(undefined))),
    ),
  );

  /** 選択肢にする会員。 */
  readonly members = input.required<PickableMember[]>();
  /** 選べない会員(自分・既にメンバー・招待中)と、その理由。 */
  readonly disabledReasons = input<Map<string, string>>(new Map());
  readonly selectedIds = model<string[]>([]);

  readonly nameQuery = signal('');

  readonly filteredMembers = computed(() => {
    const query = this.nameQuery().trim().toLowerCase();
    return this.members()
      .filter((member) => !query || member.displayName.toLowerCase().includes(query))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'));
  });

  isSelected(memberId: string): boolean {
    return this.selectedIds().includes(memberId);
  }

  toggle(memberId: string): void {
    this.selectedIds.update((ids) =>
      ids.includes(memberId) ? ids.filter((id) => id !== memberId) : [...ids, memberId],
    );
  }

  profileText(member: PickableMember): string {
    return profileSummary(member.profile, this.tenant()?.profileFields, 3);
  }
}
