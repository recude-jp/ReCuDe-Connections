import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { E2eeService } from '../../../core/services/e2ee.service';
import { PASSPHRASE_MIN_LENGTH } from '../../../core/crypto/e2ee-crypto';
import { toErrorMessage } from '../../../core/utils/errors';

/**
 * ログイン設定タブの「トークの暗号化」。暗号鍵のパスフレーズを変える(SECURITY-DEVELOPMENT.md 6-3)。
 * 鍵の作成・復元・作り直しは、トークを開いたときの画面(E2eeGate)で行う。
 */
@Component({
  selector: 'app-e2ee-settings',
  imports: [FormsModule, RouterLink],
  templateUrl: './e2ee-settings.html',
  styleUrl: '../login-account-settings/login-account-settings.scss',
})
export class E2eeSettings {
  private readonly e2ee = inject(E2eeService);

  readonly state = this.e2ee.state;
  readonly minLength = PASSPHRASE_MIN_LENGTH;

  readonly editing = signal(false);
  readonly current = signal('');
  readonly next = signal('');
  readonly confirmation = signal('');
  readonly busy = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  readonly canSave = computed(
    () =>
      !!this.current() &&
      this.next().length >= PASSPHRASE_MIN_LENGTH &&
      this.next() === this.confirmation() &&
      !this.busy(),
  );

  start(): void {
    this.current.set('');
    this.next.set('');
    this.confirmation.set('');
    this.errorMessage.set('');
    this.successMessage.set('');
    this.editing.set(true);
  }

  async save(): Promise<void> {
    if (!this.canSave()) {
      return;
    }
    this.errorMessage.set('');
    this.busy.set(true);
    try {
      await this.e2ee.changePassphrase(this.current(), this.next());
      this.editing.set(false);
      this.successMessage.set('パスフレーズを変えました。ほかの端末で暗号鍵を戻すときは、新しいパスフレーズを使ってください。');
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
