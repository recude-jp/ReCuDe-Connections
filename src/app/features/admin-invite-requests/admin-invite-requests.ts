import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { AdminService, InviteRequestRow } from '../../core/services/admin.service';
import { AdminScopeService } from '../../core/services/admin-scope.service';
import { formatDate, toMillis } from '../../core/utils/dates';
import { toErrorMessage } from '../../core/utils/errors';

type Filter = 'pending' | 'handled';

/** 招待を送るときの入力(申請ごと)。communityId が空ならルートへの招待。 */
interface InviteDraft {
  communityId: string;
  channel: 'sms' | 'email';
}

/**
 * 管理画面の招待申請(/admin/root/invite-requests)。トップページの公開フォームから届いた申請を、事務局が確認する。
 * 利用の条件(東京岐阜県人会の会員か、連携している在京同窓会の会員)を名簿などで確かめ、招待を送るか見送る。
 * 招待を送ると、招待した人は操作した管理者になる(参加すると、その管理者との1対1のトークができる)。
 */
@Component({
  selector: 'app-admin-invite-requests',
  imports: [FormsModule],
  templateUrl: './admin-invite-requests.html',
  styleUrl: './admin-invite-requests.scss',
})
export class AdminInviteRequests {
  private readonly auth = inject(AuthService);
  private readonly adminService = inject(AdminService);
  readonly scopes = inject(AdminScopeService);

  readonly formatDate = formatDate;

  private readonly requests = toSignal(
    this.auth.session$.pipe(
      switchMap((session) =>
        session?.kind === 'member' ? this.adminService.listInviteRequests(session.tenantId) : of(undefined),
      ),
    ),
  );

  private readonly members = toSignal(
    this.auth.session$.pipe(
      switchMap((session) => (session?.kind === 'member' ? this.adminService.listMembers(session.tenantId) : of(undefined))),
    ),
  );

  readonly filter = signal<Filter>('pending');
  readonly busyId = signal<string | null>(null);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  /** 見送りの理由を入力中の申請。 */
  readonly decliningId = signal<string | null>(null);
  readonly declineReason = signal('');
  private readonly drafts = signal<Record<string, InviteDraft>>({});

  readonly pendingCount = computed(() => this.requests()?.filter((r) => r.status === 'pending').length ?? 0);

  /** 確認待ちは古い順(先に届いたものから)、対応済みは新しい順。 */
  readonly list = computed(() => {
    const requests = this.requests();
    if (requests === undefined) {
      return undefined;
    }
    if (this.filter() === 'pending') {
      return requests
        .filter((r) => r.status === 'pending')
        .sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
    }
    return requests
      .filter((r) => r.status !== 'pending')
      .sort((a, b) => toMillis(b.handledAt ?? b.createdAt) - toMillis(a.handledAt ?? a.createdAt));
  });

  communityName(id: string | undefined): string {
    return (id && this.scopes.communities()?.find((c) => c.id === id)?.name) || '';
  }

  alumniText(r: InviteRequestRow): string {
    if (!r.alumniMember) {
      return 'いいえ';
    }
    return this.communityName(r.alumniCommunityId) || r.alumniOtherName || '（同窓会名なし）';
  }

  handlerName(r: InviteRequestRow): string {
    return (r.handledBy && this.members()?.find((m) => m.id === r.handledBy)?.displayName) || '';
  }

  /** 招待先の初期値: 県人会の会員ならルート、同窓会だけなら、その連携コミュニティ。 */
  draftOf(r: InviteRequestRow): InviteDraft {
    return (
      this.drafts()[r.id] ?? {
        communityId: !r.kenjinkaiMember && r.alumniCommunityId ? r.alumniCommunityId : '',
        channel: 'sms',
      }
    );
  }

  updateDraft(r: InviteRequestRow, change: Partial<InviteDraft>): void {
    this.drafts.update((all) => ({ ...all, [r.id]: { ...this.draftOf(r), ...change } }));
  }

  /** 電話番号を読みやすい形にする(+8190... → 090...)。 */
  phoneText(phone: string): string {
    return phone.startsWith('+81') ? `0${phone.slice(3)}` : phone;
  }

  async invite(r: InviteRequestRow): Promise<void> {
    const draft = this.draftOf(r);
    const target = draft.communityId ? `「${this.communityName(draft.communityId)}」` : 'ルートコミュニティ（ゲスト）';
    const to = draft.channel === 'email' ? r.email : this.phoneText(r.phoneNumber);
    if (!window.confirm(`${r.name}さんに、${target}への招待を送ります（送り先: ${to}）。よろしいですか？`)) {
      return;
    }
    await this.run(r, async () => {
      await this.adminService.decideInviteRequest({
        requestId: r.id,
        decision: 'invite',
        ...(draft.communityId ? { communityId: draft.communityId } : {}),
        channel: draft.channel,
      });
      this.successMessage.set(`${r.name}さんに招待を送りました。`);
    });
  }

  startDecline(r: InviteRequestRow): void {
    this.decliningId.set(r.id);
    this.declineReason.set('');
  }

  async decline(r: InviteRequestRow): Promise<void> {
    await this.run(r, async () => {
      await this.adminService.decideInviteRequest({
        requestId: r.id,
        decision: 'decline',
        declineReason: this.declineReason().trim(),
      });
      this.decliningId.set(null);
      this.successMessage.set(`${r.name}さんの申請を見送りにしました。`);
    });
  }

  private async run(r: InviteRequestRow, action: () => Promise<void>): Promise<void> {
    this.errorMessage.set('');
    this.successMessage.set('');
    this.busyId.set(r.id);
    try {
      await action();
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.busyId.set(null);
    }
  }
}
