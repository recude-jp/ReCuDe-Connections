import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { E2eeService } from '../../../core/services/e2ee.service';
import { toPasskeyErrorMessage } from '../../../core/utils/errors';

/**
 * ログイン設定タブの「トークの暗号化」(SECURITY-DEVELOPMENT.md 6-3)。
 * 回復コードを作り直す(パスキーで鍵を開く)、この端末のパスキーでも鍵を守る(回復コードで鍵を開く)。
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
  readonly hasPasskeyBackup = this.e2ee.hasPasskeyBackup;

  /** 作り直した回復コード(表示するのはこのときだけ)。 */
  readonly newRecoveryCode = signal('');
  readonly addingPasskey = signal(false);
  readonly codeInput = signal('');
  readonly busy = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  async regenerateRecoveryCode(): Promise<void> {
    if (!window.confirm('回復コードを作り直します。今の回復コードは使えなくなります。よろしいですか？')) {
      return;
    }
    await this.run(async () => {
      this.newRecoveryCode.set(await this.e2ee.regenerateRecoveryCode());
    });
  }

  async addPasskey(): Promise<void> {
    if (!this.codeInput().trim()) {
      return;
    }
    await this.run(async () => {
      await this.e2ee.addPasskeyWithRecoveryCode(this.codeInput());
      this.codeInput.set('');
      this.addingPasskey.set(false);
      this.successMessage.set('この端末のパスキーでも、暗号鍵を守るようにしました。');
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.errorMessage.set('');
    this.successMessage.set('');
    this.busy.set(true);
    try {
      await action();
    } catch (err) {
      this.errorMessage.set(toPasskeyErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
