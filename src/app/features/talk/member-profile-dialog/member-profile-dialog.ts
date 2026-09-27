import { Component, computed, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { combineLatest, of, switchMap } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { CommunityRow, MemberService } from '../../../core/services/member.service';
import { ConnectionService } from '../../../core/services/connection.service';
import { MemberAvatar } from '../../../shared/member-avatar/member-avatar';
import { formatProfileValue, visibleProfileFields } from '../../../core/utils/profile-fields';
import { isFullMember } from '../../../core/utils/membership';
import { toErrorMessage } from '../../../core/utils/errors';

/** 相手とのつながりの状態。 */
type ConnectionState =
  | { kind: 'loading' }
  | { kind: 'self' }
  | { kind: 'accepted'; connectionId: string }
  | { kind: 'pendingSent' }
  | { kind: 'pendingReceived'; connectionId: string }
  | { kind: 'none' };

/**
 * トークのメッセージのプロフィール画像を押したときに出す、その人のプロフィール。
 * 下のボタンで1対1のトークを始める(SPEC 5-1: 1対1のトークは、つながりが承認された人とだけできる)。
 * - つながっている: 1対1のトークを開く。
 * - 相手から申請が届いている: 承認して、1対1のトークを開く。
 * - まだつながっていない: つながり申請を送る(相手が承認すると1対1のトークができる)。
 */
@Component({
  selector: 'app-member-profile-dialog',
  imports: [MemberAvatar],
  templateUrl: './member-profile-dialog.html',
  styleUrl: './member-profile-dialog.scss',
  host: { '(document:keydown.escape)': 'closed.emit()' },
})
export class MemberProfileDialog {
  private readonly auth = inject(AuthService);
  private readonly memberService = inject(MemberService);
  private readonly connectionService = inject(ConnectionService);
  private readonly router = inject(Router);

  readonly memberId = input.required<string>();
  readonly closed = output<void>();

  private readonly session = toSignal(this.auth.session$, { initialValue: undefined });
  readonly memberSession = computed(() => {
    const session = this.session();
    return session?.kind === 'member' ? session : null;
  });

  readonly member = toSignal(
    combineLatest([this.auth.session$, toObservable(this.memberId)]).pipe(
      switchMap(([session, id]) => (session?.kind === 'member' ? this.memberService.getMember(session.tenantId, id) : of(undefined))),
    ),
  );
  private readonly tenant = toSignal(
    this.auth.session$.pipe(
      switchMap((session) => (session?.kind === 'member' ? this.memberService.getTenant(session.tenantId) : of(undefined))),
    ),
  );
  private readonly communities = toSignal(
    this.auth.session$.pipe(
      switchMap((session) => (session?.kind === 'member' ? this.memberService.listCommunities(session.tenantId) : of([]))),
    ),
    { initialValue: [] as CommunityRow[] },
  );
  /** 自分のつながり(相手とのつながりのドキュメントは、無いときに直接は読めないため、自分の一覧から探す)。 */
  private readonly connections = toSignal(
    this.auth.session$.pipe(
      switchMap((session) =>
        session?.kind === 'member' ? this.connectionService.listMyConnections(session.tenantId, session.memberId) : of([]),
      ),
    ),
  );

  /** 他の会員に見せる項目(非公開の項目は出さない)。 */
  readonly profileItems = computed(() => {
    const member = this.member();
    return visibleProfileFields(this.tenant()?.profileFields)
      .filter((field) => !field.private)
      .map((field) => ({ label: field.label, value: formatProfileValue(member?.profile?.[field.id], field) }))
      .filter((item) => item.value);
  });
  readonly memberCommunities = computed(() => {
    const ids = this.member()?.communityIds ?? [];
    return this.communities().filter((c) => ids.includes(c.id));
  });

  readonly state = computed<ConnectionState>(() => {
    const session = this.memberSession();
    const list = this.connections();
    if (!session || list === undefined) {
      return { kind: 'loading' };
    }
    if (session.memberId === this.memberId()) {
      return { kind: 'self' };
    }
    const found = list.find((c) => c.memberIds.includes(this.memberId()));
    if (!found || found.status === 'declined') {
      return { kind: 'none' };
    }
    if (found.status === 'accepted') {
      return { kind: 'accepted', connectionId: found.id };
    }
    return found.requestedBy === session.memberId
      ? { kind: 'pendingSent' }
      : { kind: 'pendingReceived', connectionId: found.id };
  });

  /** つながり申請を送れない理由(送れるときは空)。 */
  readonly cannotRequestReason = computed(() => {
    if (this.memberSession()?.isGuest) {
      return 'つながり申請は、正規の会員になるとできるようになります。';
    }
    const member = this.member();
    if (member && (!member.isActive || !isFullMember(member))) {
      return 'この方には、まだつながり申請を送れません。';
    }
    return '';
  });

  readonly processing = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  openTalk(connectionId: string): void {
    this.closed.emit();
    // 1対1のルームのIDは、つながりのIDと同じ。
    void this.router.navigate(['/talk/rooms', connectionId]);
  }

  async sendRequest(): Promise<void> {
    await this.run(async () => {
      await this.connectionService.sendRequest(this.memberId());
      this.successMessage.set('つながり申請を送りました。承認されると、1対1のトークができるようになります。');
    });
  }

  async acceptAndOpen(connectionId: string): Promise<void> {
    await this.run(async () => {
      await this.connectionService.respond(connectionId, true);
      this.openTalk(connectionId);
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
