import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { NEVER, Observable, combineLatest, map, of, switchMap } from 'rxjs';
import { AuthService, MemberSession } from '../../../core/services/auth.service';
import { RoomService, WithId } from '../../../core/services/room.service';
import type { Member } from '../../../core/models/firestore.models';
import { MemberPicker } from '../../../shared/member-picker/member-picker';
import { formatDate } from '../../../core/utils/dates';
import { toErrorMessage } from '../../../core/utils/errors';
import { GROUP_MEMBER_LIMIT } from '../group-create/group-create';
import { isFullMember } from '../../../core/utils/membership';

/**
 * グループ情報(/talk/rooms/:roomId/info)。メンバー一覧、グループ管理者の任命、招待中の人、メンバーの招待、退出。
 * グループ管理者は複数人でき、常に1人以上いる。他にグループ管理者がいない人は退出できない(サーバー側でも確認する)。
 * ただし最後の1人は退出でき、そのときグループは削除される(退出前に確認する)。
 */
@Component({
  selector: 'app-group-info',
  imports: [RouterLink, MemberPicker],
  templateUrl: './group-info.html',
  styleUrl: './group-info.scss',
})
export class GroupInfo {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly roomService = inject(RoomService);

  readonly roomId = this.route.snapshot.paramMap.get('roomId') ?? '';
  readonly limit = GROUP_MEMBER_LIMIT;
  readonly formatDate = formatDate;

  readonly session = toSignal(this.auth.session$, { initialValue: undefined });
  readonly memberSession = computed(() => {
    const session = this.session();
    return session?.kind === 'member' ? (session as MemberSession) : null;
  });

  /**
   * このグループのデータを購読しているか。退出する直前に false にして購読をやめる。
   * 購読したまま自分が読めなくなる(退出・削除)と、Firestoreの他のリアルタイム更新(トーク一覧)まで
   * 届かなくなることがあったため(Emulatorで確認)。
   */
  private readonly listening = signal(true);

  /** グループ内のデータの購読。listening が false の間は購読をやめ、最後に表示した値を残す。 */
  private roomScoped<T>(fallback: T, source: (tenantId: string) => Observable<T>): Observable<T> {
    return combineLatest([this.auth.session$, toObservable(this.listening)]).pipe(
      switchMap(([session, listening]) =>
        !listening ? NEVER : session?.kind === 'member' ? source(session.tenantId) : of(fallback),
      ),
    );
  }

  readonly room = toSignal(
    this.roomScoped(undefined, (tenantId) => this.roomService.getRoom(tenantId, this.roomId)),
    { initialValue: undefined },
  );

  private readonly roomMembers = toSignal(
    this.roomScoped([], (tenantId) => this.roomService.listRoomMembers(tenantId, this.roomId)),
    { initialValue: [] },
  );

  private readonly invitations = toSignal(
    this.roomScoped([], (tenantId) => this.roomService.listPendingInvitations(tenantId, this.roomId)),
    { initialValue: [] },
  );

  /** 表示名の解決と招待の候補に使う、テナントの有効な会員。 */
  private readonly tenantMembers = toSignal(
    this.auth.session$.pipe(
      switchMap((session) => (session?.kind === 'member' ? this.roomService.listActiveMembers(session.tenantId) : of([]))),
      map((members) => new Map(members.map((m) => [m.id, m] as const))),
    ),
    { initialValue: new Map<string, WithId<Member>>() },
  );

  nameOf(memberId: string | null): string {
    return (memberId && this.tenantMembers().get(memberId)?.displayName) || '会員';
  }

  readonly members = computed(() =>
    this.roomMembers().map((m) => ({ ...m, name: this.nameOf(m.id), isSelf: m.id === this.memberSession()?.memberId })),
  );

  private readonly adminIds = computed(() => this.roomMembers().filter((m) => m.role === 'admin').map((m) => m.id));

  /** 自分がグループ管理者か(グループ管理者の任命・解除ができる)。 */
  readonly isGroupAdmin = computed(() => this.adminIds().includes(this.memberSession()?.memberId ?? ''));

  /** 自分が唯一のグループ管理者か(この場合は退出できず、自分をグループ管理者から外すこともできない)。 */
  readonly isOnlyGroupAdmin = computed(() => this.isGroupAdmin() && this.adminIds().length === 1);

  /** 自分が最後の1人のメンバーか(退出するとグループが削除される)。 */
  readonly isLastMember = computed(() => this.room()?.memberCount === 1);

  /** 退出できるか。唯一のグループ管理者は退出できないが、最後の1人なら退出できる(グループは削除される)。 */
  readonly canLeave = computed(() => !this.isOnlyGroupAdmin() || this.isLastMember());

  readonly pendingInvitations = computed(() =>
    this.invitations().map((inv) => ({ ...inv, name: this.nameOf(inv.inviteeId), inviterName: this.nameOf(inv.invitedBy) })),
  );

  /** 招待の候補(ゲストはグループに参加できないため除く)。 */
  readonly candidates = computed(() => [...this.tenantMembers().values()].filter((m) => isFullMember(m)));

  /** 選べない会員(既にメンバー・招待中)。 */
  readonly disabledReasons = computed(() => {
    const reasons = new Map<string, string>();
    for (const id of this.room()?.memberIds ?? []) {
      reasons.set(id, 'メンバー');
    }
    for (const inv of this.invitations()) {
      reasons.set(inv.inviteeId, '招待中');
    }
    return reasons;
  });

  readonly remaining = computed(() => {
    const room = this.room();
    return room ? this.limit - room.memberCount - this.invitations().length : 0;
  });

  readonly inviteeIds = signal<string[]>([]);
  readonly processing = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  async invite(): Promise<void> {
    if (this.inviteeIds().length === 0) {
      return;
    }
    await this.run(async () => {
      const count = await this.roomService.inviteToGroup(this.roomId, this.inviteeIds());
      this.inviteeIds.set([]);
      this.successMessage.set(`${count}人を招待しました。参加するかどうかは招待された人が選びます。`);
    });
  }

  async setGroupAdmin(memberId: string, name: string, makeAdmin: boolean): Promise<void> {
    await this.run(async () => {
      await this.roomService.setGroupAdmin(this.roomId, memberId, makeAdmin);
      this.successMessage.set(
        makeAdmin ? `${name}さんをグループ管理者にしました。` : `${name}さんをグループ管理者から外しました。`,
      );
    });
  }

  async leave(): Promise<void> {
    if (!this.canLeave()) {
      return;
    }
    const name = this.room()?.name ?? 'グループ';
    const message = this.isLastMember()
      ? `あなたは「${name}」の最後のメンバーです。\n退出すると、このグループは削除になります（メッセージも消え、元に戻せません）。\n\nよいですか？`
      : `「${name}」から退出します。\n\nよろしいですか？`;
    if (!window.confirm(message)) {
      return;
    }
    this.listening.set(false);
    await this.run(async () => {
      try {
        await this.roomService.leaveGroup(this.roomId);
      } catch (err) {
        // 退出できなかったときは購読を再開する。
        this.listening.set(true);
        throw err;
      }
      await this.router.navigate(['/talk']);
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.errorMessage.set('');
    this.successMessage.set('');
    this.processing.set(true);
    try {
      await action();
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.processing.set(false);
    }
  }
}
