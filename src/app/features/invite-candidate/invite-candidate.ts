import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ConnectTabs } from '../../shared/connect-tabs/connect-tabs';
import { InviteTargetOption, InviteTargetPicker } from '../../shared/invite-target-picker/invite-target-picker';
import { InviteService } from '../../core/services/invite.service';
import { toE164 } from '../../core/utils/phone';
import { toErrorMessage } from '../../core/utils/errors';

type Destination = 'phone' | 'email';

/**
 * 招待の送付(/connect/send)。名前(必須)と、電話番号(SMS)かメールアドレスに、招待リンクを送る。
 * 招待された人はリンクから電話番号でログインしてゲスト(連携コミュニティへの招待なら、そのメンバー)になり、
 * 招待した人と1対1のトークができる。招待先は QRコードの画面と同じく選べる(?to= で引き継ぐ)。
 */
@Component({
  selector: 'app-invite-candidate',
  imports: [FormsModule, RouterLink, ConnectTabs, InviteTargetPicker],
  templateUrl: './invite-candidate.html',
  styleUrl: './invite-candidate.scss',
})
export class InviteCandidate {
  private readonly inviteService = inject(InviteService);

  /** 選んでいる招待先。 */
  readonly target = signal<InviteTargetOption | null>(null);

  readonly name = signal('');
  readonly destination = signal<Destination>('phone');
  readonly phoneNumber = signal('');
  readonly email = signal('');
  readonly loading = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  readonly canSend = computed(
    () =>
      !!this.target() &&
      !!this.name().trim() &&
      (this.destination() === 'phone' ? !!this.phoneNumber().trim() : !!this.email().trim()),
  );

  async sendInvite(): Promise<void> {
    if (!this.canSend()) {
      return;
    }
    this.errorMessage.set('');
    this.successMessage.set('');
    this.loading.set(true);
    try {
      const name = this.name().trim();
      const target = this.target()!;
      await this.inviteService.createInvite(
        this.destination() === 'phone'
          ? { name, phoneNumber: toE164(this.phoneNumber()), target: target.target }
          : { name, email: this.email().trim(), target: target.target },
      );
      this.successMessage.set(
        `${name}さんに「${target.name}」への招待を送りました（${this.destination() === 'phone' ? 'SMS' : 'メール'}）。`,
      );
      this.name.set('');
      this.phoneNumber.set('');
      this.email.set('');
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
