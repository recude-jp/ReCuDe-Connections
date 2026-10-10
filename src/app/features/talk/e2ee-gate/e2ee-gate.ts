import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faLock } from '@fortawesome/free-solid-svg-icons';
import { E2eeService } from '../../../core/services/e2ee.service';
import { PASSPHRASE_MIN_LENGTH, WrongPassphraseError } from '../../../core/crypto/e2ee-crypto';
import { toErrorMessage } from '../../../core/utils/errors';

/**
 * トークを使う前の、暗号鍵の準備(SECURITY-DEVELOPMENT.md 6-3)。
 * 初めて使うときはパスフレーズを決めて鍵を作り、新しい端末ではパスフレーズで鍵を戻す。
 * パスフレーズを忘れたときは、鍵を作り直せる(これまでの会話は読めなくなる)。
 */
@Component({
  selector: 'app-e2ee-gate',
  imports: [FormsModule, FaIconComponent],
  templateUrl: './e2ee-gate.html',
  styleUrl: './e2ee-gate.scss',
})
export class E2eeGate {
  private readonly e2ee = inject(E2eeService);

  readonly lockIcon = faLock;
  readonly minLength = PASSPHRASE_MIN_LENGTH;
  readonly state = this.e2ee.state;

  /** パスフレーズを忘れて、鍵を作り直す画面を開いているか。 */
  readonly resetting = signal(false);
  readonly passphrase = signal('');
  readonly confirmation = signal('');
  readonly understood = signal(false);
  readonly busy = signal(false);
  readonly errorMessage = signal('');

  /** 鍵を作る(初めて・作り直し)ときの入力が揃っているか。 */
  readonly canCreate = computed(
    () =>
      this.passphrase().length >= PASSPHRASE_MIN_LENGTH &&
      this.passphrase() === this.confirmation() &&
      this.understood() &&
      !this.busy(),
  );

  async create(): Promise<void> {
    if (!this.canCreate()) {
      return;
    }
    await this.run(async () => {
      if (this.resetting()) {
        await this.e2ee.reset(this.passphrase());
      } else {
        await this.e2ee.setup(this.passphrase());
      }
    });
  }

  async restore(): Promise<void> {
    if (!this.passphrase() || this.busy()) {
      return;
    }
    await this.run(() => this.e2ee.restore(this.passphrase()));
  }

  startReset(): void {
    this.resetting.set(true);
    this.clear();
  }

  cancelReset(): void {
    this.resetting.set(false);
    this.clear();
  }

  private clear(): void {
    this.passphrase.set('');
    this.confirmation.set('');
    this.understood.set(false);
    this.errorMessage.set('');
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.errorMessage.set('');
    this.busy.set(true);
    try {
      await action();
      this.clear();
    } catch (err) {
      this.errorMessage.set(err instanceof WrongPassphraseError ? err.message : toErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
