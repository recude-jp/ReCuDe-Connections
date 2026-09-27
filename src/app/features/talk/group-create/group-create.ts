import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import { AuthService, MemberSession } from '../../../core/services/auth.service';
import { RoomService, WithId } from '../../../core/services/room.service';
import type { Member } from '../../../core/models/firestore.models';
import { MemberPicker } from '../../../shared/member-picker/member-picker';
import { toErrorMessage } from '../../../core/utils/errors';
import { isFullMember } from '../../../core/utils/membership';

/** グループの人数上限(functions/src/rooms.ts の GROUP_MEMBER_LIMIT と揃える)。 */
export const GROUP_MEMBER_LIMIT = 50;

/** グループ作成(/talk/new-group)。グループ名・説明を入れ、招待する会員を選ぶ(招待された人が参加するかを選ぶ)。 */
@Component({
  selector: 'app-group-create',
  imports: [FormsModule, RouterLink, MemberPicker],
  templateUrl: './group-create.html',
  styleUrl: './group-create.scss',
})
export class GroupCreate {
  private readonly auth = inject(AuthService);
  private readonly roomService = inject(RoomService);
  private readonly router = inject(Router);

  readonly session = toSignal(this.auth.session$, { initialValue: undefined });
  readonly memberSession = computed(() => {
    const session = this.session();
    return session?.kind === 'member' ? (session as MemberSession) : null;
  });

  readonly members = toSignal(
    this.auth.session$.pipe(
      switchMap((session) => (session?.kind === 'member' ? this.roomService.listActiveMembers(session.tenantId) : of([]))),
    ),
    { initialValue: [] as WithId<Member>[] },
  );

  /** 自分以外の会員を選択肢にする。 */
  /** 自分以外の正規の会員を選択肢にする(ゲストはグループに参加できない)。 */
  readonly candidates = computed(() =>
    this.members().filter((m) => m.id !== this.memberSession()?.memberId && isFullMember(m)),
  );

  readonly name = signal('');
  readonly description = signal('');
  readonly inviteeIds = signal<string[]>([]);
  readonly saving = signal(false);
  readonly errorMessage = signal('');

  readonly limit = GROUP_MEMBER_LIMIT;

  async create(): Promise<void> {
    const name = this.name().trim();
    if (!name) {
      this.errorMessage.set('グループ名を入力してください。');
      return;
    }
    this.errorMessage.set('');
    this.saving.set(true);
    try {
      const roomId = await this.roomService.createGroup(name, this.description().trim(), this.inviteeIds());
      await this.router.navigate(['/talk/rooms', roomId]);
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
