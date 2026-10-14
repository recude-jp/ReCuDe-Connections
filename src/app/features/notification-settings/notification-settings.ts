import { Component, inject, signal } from '@angular/core';
import { PushService } from '../../core/services/push.service';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faBell, faBellSlash } from '@fortawesome/free-solid-svg-icons';
import { Spinner } from '../../shared/spinner/spinner';
import { toErrorMessage } from '../../core/utils/errors';

/**
 * マイページ > 通知(/mypage/notifications)。この端末で、新着メッセージなどのプッシュ通知を受け取るかを切り替える。
 * iPhone・iPad は、ホーム画面に追加したアプリでだけ通知を受け取れるため、追加の手順を案内する。
 */
@Component({
  selector: 'app-notification-settings',
  imports: [Spinner, FaIconComponent],
  templateUrl: './notification-settings.html',
  styleUrl: './notification-settings.scss',
})
export class NotificationSettings {
  private readonly push = inject(PushService);

  readonly bellIcon = faBell;
  readonly bellOffIcon = faBellSlash;
  readonly state = this.push.state;
  readonly isIos = this.push.isIos();
  readonly loaded = signal(false);
  readonly busy = signal(false);
  readonly errorMessage = signal('');

  constructor() {
    void this.push.refresh().finally(() => this.loaded.set(true));
  }

  async enable(): Promise<void> {
    await this.run(async () => {
      await this.push.enable();
    });
    // 許可を求める画面で「許可しない」を選ぶと、ブロックの状態になる。
    if (this.errorMessage()) {
      await this.push.refresh();
      if (this.state() === 'denied') {
        this.errorMessage.set('');
      }
    }
  }

  async disable(): Promise<void> {
    await this.run(() => this.push.disable());
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.errorMessage.set('');
    this.busy.set(true);
    try {
      await action();
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
