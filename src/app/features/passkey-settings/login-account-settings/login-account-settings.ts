import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LoginService, LoginSettings } from '../../../core/services/login.service';
import { PasskeyService } from '../../../core/services/passkey.service';
import { PinInput } from '../../../shared/pin-input/pin-input';
import { toErrorMessage } from '../../../core/utils/errors';

/**
 * ログイン設定タブの「ログインID・メールアドレス」。ログインIDの変更と、メールアドレスの登録
 * (確認コードで本人のアドレスか確かめる)・ログインIDとして使うかの切り替えをする。
 */
@Component({
  selector: 'app-login-account-settings',
  imports: [FormsModule, PinInput],
  templateUrl: './login-account-settings.html',
  styleUrl: './login-account-settings.scss',
})
export class LoginAccountSettings {
  private readonly login = inject(LoginService);
  private readonly passkey = inject(PasskeyService);

  readonly settings = signal<LoginSettings | undefined>(undefined);
  readonly busy = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  readonly editingLoginId = signal(false);
  readonly loginIdInput = signal('');

  /** メールアドレスの登録・変更の入力中か。codeSent: 確認コードを送ったあと。 */
  readonly editingEmail = signal(false);
  readonly emailInput = signal('');
  readonly codeSent = signal(false);
  readonly emailCode = signal('');
  readonly useEmailAsLoginId = signal(false);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.settings.set(await this.login.getSettings());
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    }
  }

  private begin(): void {
    this.errorMessage.set('');
    this.successMessage.set('');
    this.busy.set(true);
  }

  /** この端末にパスキーがあれば、新しいIDでもログイン画面でパスキーを試せるようにする。 */
  private rememberForPasskey(identifier: string): void {
    if (this.passkey.hasLocalPasskeyHint('member')) {
      this.passkey.rememberPasskeyFor([identifier]);
    }
  }

  startEditLoginId(): void {
    this.loginIdInput.set(this.settings()?.loginId ?? '');
    this.editingLoginId.set(true);
  }

  async saveLoginId(): Promise<void> {
    const loginId = this.loginIdInput().trim();
    if (!loginId) {
      return;
    }
    this.begin();
    try {
      const saved = await this.login.setLoginId(loginId);
      this.rememberForPasskey(saved);
      this.settings.update((s) => (s ? { ...s, loginId: saved } : s));
      this.editingLoginId.set(false);
      this.successMessage.set('ログインIDを設定しました。');
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  startEditEmail(): void {
    this.emailInput.set('');
    this.emailCode.set('');
    this.codeSent.set(false);
    this.useEmailAsLoginId.set(this.settings()?.emailLogin ?? false);
    this.editingEmail.set(true);
  }

  cancelEditEmail(): void {
    this.editingEmail.set(false);
    this.errorMessage.set('');
  }

  async sendEmailCode(): Promise<void> {
    const email = this.emailInput().trim();
    if (!email) {
      return;
    }
    this.begin();
    try {
      await this.login.startEmailRegistration(email);
      this.emailCode.set('');
      this.codeSent.set(true);
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  async confirmEmail(): Promise<void> {
    if (this.emailCode().length !== 6) {
      return;
    }
    this.begin();
    try {
      const { email, emailLogin } = await this.login.confirmEmailRegistration(
        this.emailCode(),
        this.useEmailAsLoginId(),
      );
      if (emailLogin) {
        this.rememberForPasskey(email);
      }
      this.settings.update((s) => (s ? { ...s, email, emailLogin } : s));
      this.editingEmail.set(false);
      this.successMessage.set('メールアドレスを登録しました。');
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  async toggleEmailLogin(enabled: boolean): Promise<void> {
    this.begin();
    try {
      const emailLogin = await this.login.setEmailLogin(enabled);
      const email = this.settings()?.email;
      if (emailLogin && email) {
        this.rememberForPasskey(email);
      }
      this.settings.update((s) => (s ? { ...s, emailLogin } : s));
      this.successMessage.set(
        emailLogin ? 'メールアドレスでもログインできるようにしました。' : 'メールアドレスでのログインをやめました。',
      );
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  async removeEmail(): Promise<void> {
    if (!window.confirm('登録したメールアドレスを削除します。メールでは認証コードを受け取れなくなります。よろしいですか？')) {
      return;
    }
    this.begin();
    try {
      await this.login.removeEmail();
      this.settings.update((s) => (s ? { ...s, email: null, emailLogin: false } : s));
      this.successMessage.set('メールアドレスを削除しました。');
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
