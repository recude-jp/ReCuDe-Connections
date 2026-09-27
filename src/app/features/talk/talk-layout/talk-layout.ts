import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faPlus, faUsers } from '@fortawesome/free-solid-svg-icons';
import { combineLatest, distinctUntilChanged, filter, map, of, startWith, switchMap } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { RoomService } from '../../../core/services/room.service';
import { MemberService } from '../../../core/services/member.service';
import { MemberAvatar } from '../../../shared/member-avatar/member-avatar';
import { CountBadge } from '../../../shared/count-badge/count-badge';
import { formatMessageTime } from '../../../core/utils/dates';
import { toErrorMessage } from '../../../core/utils/errors';

/**
 * トーク(/talk)の2列レイアウト。左のサイドバーに、届いているグループ招待・グループ・1対1の一覧を出し、
 * 選んだルームを右に表示する。スマホ幅では一覧とトーク画面を切り替えて表示する(ルームを開くと一覧を隠す)。
 */
/** トーク一覧に出す、相手のプロフィール画像とアイコンの文字。 */
interface AvatarInfo {
  photoPath?: string;
  text?: string;
}

@Component({
  selector: 'app-talk-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FaIconComponent, MemberAvatar, CountBadge],
  templateUrl: './talk-layout.html',
  styleUrl: './talk-layout.scss',
})
export class TalkLayout {
  private readonly auth = inject(AuthService);
  private readonly roomService = inject(RoomService);
  private readonly memberService = inject(MemberService);
  private readonly router = inject(Router);

  readonly icons = { group: faUsers, plus: faPlus };

  readonly threads = toSignal(
    this.auth.session$.pipe(
      switchMap((session) =>
        session?.kind === 'member' ? this.roomService.listThreads(session.tenantId, session.memberId) : of(undefined),
      ),
    ),
  );

  readonly invitations = toSignal(
    this.auth.session$.pipe(
      switchMap((session) =>
        session?.kind === 'member'
          ? this.roomService.listGroupInvitations(session.tenantId, session.memberId)
          : of([]),
      ),
    ),
    { initialValue: [] },
  );

  readonly isGuest = toSignal(
    this.auth.session$.pipe(map((session) => session?.kind === 'member' && session.isGuest)),
    { initialValue: false },
  );

  readonly groupThreads = computed(() => (this.threads() ?? []).filter((t) => t.roomType === 'group'));
  readonly directThreads = computed(() => (this.threads() ?? []).filter((t) => t.roomType === 'direct'));

  /** 1対1の相手のプロフィール画像とアイコンの文字(相手の会員ID →)。 */
  readonly avatars = toSignal(
    toObservable(computed(() => this.directThreads().map((t) => t.otherMemberId ?? '').filter(Boolean))).pipe(
      distinctUntilChanged((a, b) => a.join() === b.join()),
      switchMap((ids) => {
        const session = this.auth.currentSession;
        if (session?.kind !== 'member' || ids.length === 0) {
          return of(new Map<string, AvatarInfo>());
        }
        return combineLatest(ids.map((id) => this.memberService.getMember(session.tenantId, id))).pipe(
          map((members) => {
            const avatars = new Map<string, AvatarInfo>();
            members.forEach(
              (member, i) => member && avatars.set(ids[i], { photoPath: member.photoPath, text: member.avatarText }),
            );
            return avatars;
          }),
        );
      }),
    ),
    { initialValue: new Map<string, AvatarInfo>() },
  );

  /** ルームやグループ作成を開いているか(スマホ幅では一覧を隠してそちらを全面に出す)。 */
  readonly hasDetail = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      startWith(null),
      map(() => this.router.url.split(/[?#]/)[0] !== '/talk'),
    ),
    { initialValue: false },
  );

  readonly respondingRoomId = signal<string | null>(null);
  readonly errorMessage = signal('');

  readonly formatTime = formatMessageTime;

  async respond(roomId: string, accept: boolean): Promise<void> {
    this.errorMessage.set('');
    this.respondingRoomId.set(roomId);
    try {
      const status = await this.roomService.respondToInvitation(roomId, accept);
      if (status === 'expired') {
        this.errorMessage.set('この招待は取り消されました（グループが削除された可能性があります）。');
      } else if (status === 'accepted') {
        await this.router.navigate(['/talk/rooms', roomId]);
      }
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.respondingRoomId.set(null);
    }
  }
}
