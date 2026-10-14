import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';

export type LoginChannel = 'email' | 'sms';

export interface LoginChannels {
  email: boolean;
  sms: boolean;
}

export interface LoginSettings {
  loginId: string | null;
  email: string | null;
  /** メールアドレスをログインIDの代わりに使えるか。 */
  emailLogin: boolean;
}

/**
 * ログインID・メールアドレスと、メール・SMSの認証コードによるログイン(SPEC 1章「ログイン方式の変更」)。
 * ログイン中の会員がログインID・メールアドレスを設定する処理も持つ。
 */
@Injectable({ providedIn: 'root' })
export class LoginService {
  private readonly functions = inject(Functions);

  /** 入力したIDの認証コードの送り先。登録されていないIDにも(ダミーの)送り先が返る。 */
  async start(identifier: string): Promise<LoginChannels> {
    const fn = httpsCallable<{ identifier: string }, { channels: LoginChannels }>(this.functions, 'startLogin');
    return (await fn({ identifier })).data.channels;
  }

  async sendCode(identifier: string, channel: LoginChannel): Promise<void> {
    const fn = httpsCallable<{ identifier: string; channel: LoginChannel }, { sent: boolean }>(
      this.functions,
      'sendLoginCode',
    );
    await fn({ identifier, channel });
  }

  /** 認証コードが合っていれば、Firebase Auth のカスタムトークンを返す。 */
  async verifyCode(
    identifier: string,
    code: string,
  ): Promise<{ customToken: string; needsLoginId: boolean; hasPasskey?: boolean }> {
    const fn = httpsCallable<
      { identifier: string; code: string },
      { customToken: string; needsLoginId: boolean; hasPasskey?: boolean }
    >(
      this.functions,
      'verifyLoginCode',
    );
    return (await fn({ identifier, code })).data;
  }

  async getSettings(): Promise<LoginSettings> {
    const fn = httpsCallable<Record<string, never>, LoginSettings>(this.functions, 'getLoginSettings');
    return (await fn({})).data;
  }

  async setLoginId(loginId: string): Promise<string> {
    const fn = httpsCallable<{ loginId: string }, { loginId: string }>(this.functions, 'setLoginId');
    return (await fn({ loginId })).data.loginId;
  }

  async startEmailRegistration(email: string): Promise<void> {
    const fn = httpsCallable<{ email: string }, { sent: boolean }>(this.functions, 'startEmailRegistration');
    await fn({ email });
  }

  async confirmEmailRegistration(code: string, useAsLoginId: boolean): Promise<{ email: string; emailLogin: boolean }> {
    const fn = httpsCallable<{ code: string; useAsLoginId: boolean }, { email: string; emailLogin: boolean }>(
      this.functions,
      'confirmEmailRegistration',
    );
    return (await fn({ code, useAsLoginId })).data;
  }

  async setEmailLogin(enabled: boolean): Promise<boolean> {
    const fn = httpsCallable<{ enabled: boolean }, { emailLogin: boolean }>(this.functions, 'setEmailLogin');
    return (await fn({ enabled })).data.emailLogin;
  }

  async removeEmail(): Promise<void> {
    const fn = httpsCallable<Record<string, never>, { removed: boolean }>(this.functions, 'removeEmail');
    await fn({});
  }
}
