import { AfterViewInit, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { PublicBrandingService } from '../../core/services/public-branding.service';
import { FaviconService } from '../../core/services/favicon.service';
import { Title } from '@angular/platform-browser';
import { DEFAULT_SITE_TITLE } from '../../core/utils/branding';
import { PasskeyService } from '../../core/services/passkey.service';
import { PinService } from '../../core/services/pin.service';
import { PinInput } from '../../shared/pin-input/pin-input';
import { toE164 } from '../../core/utils/phone';
import { toErrorMessage, toPasskeyErrorMessage, toPhoneAuthErrorMessage } from '../../core/utils/errors';
import { environment } from '../../../environments/environment';

type Step = 'phone' | 'otp' | 'pin';

@Component({
  selector: 'app-member-login',
  imports: [FormsModule, PinInput],
  templateUrl: './member-login.html',
  styleUrl: './member-login.scss'
})
export class MemberLogin implements AfterViewInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly publicBranding = inject(PublicBrandingService);
  private readonly favicon = inject(FaviconService);
  private readonly titleService = inject(Title);
  private readonly passkey = inject(PasskeyService);
  private readonly pin = inject(PinService);

  readonly step = signal<Step>('phone');
  readonly phoneNumber = signal('');
  readonly otpCode = signal('');
  readonly pinCode = signal('');
  readonly loading = signal(false);
  readonly errorMessage = signal('');
  readonly passkeySupported = signal(this.passkey.isSupported() && this.passkey.hasLocalPasskeyHint('member'));
  readonly pinSupported = signal(this.pin.isLocalPinConfigured('member'));

  readonly siteTitle = signal<string | null>(null);
  readonly logoUrl = signal<string | null>(null);

  constructor() {
    this.publicBranding
      .getTenant(environment.tenantId)
      .then((tenant) => {
        this.siteTitle.set(tenant?.branding.siteTitle || DEFAULT_SITE_TITLE);
        this.logoUrl.set(tenant?.branding.logoUrl ?? null);
        // ログイン前の画面でも、タブのタイトルとアイコンをテナントのものにする。
        this.titleService.setTitle(tenant?.branding.siteTitle || DEFAULT_SITE_TITLE);
        this.favicon.rememberTitle(tenant?.branding.siteTitle || DEFAULT_SITE_TITLE);
        this.favicon.apply(tenant?.branding.faviconUrl || tenant?.branding.logoUrl);
      })
      .catch(() => this.siteTitle.set(DEFAULT_SITE_TITLE));
  }

  ngAfterViewInit(): void {
    this.auth.initRecaptcha('recaptcha-container');

    // この端末にパスキーまたはPINの登録記録があれば、既知の端末とみなしてパスキーログインを自動的に試みる。
    // パスキーが未登録(PINのみ設定済み)の場合は認証情報が見つからず自動的に失敗するので、エラーは出さず
    // 通常の電話番号入力画面へ静かにフォールバックする。
    if (this.passkeySupported() || this.pinSupported()) {
      void this.signInWithPasskey(true);
    }
  }

  async sendOtp(): Promise<void> {
    this.errorMessage.set('');
    this.loading.set(true);
    try {
      await this.auth.sendOtp(toE164(this.phoneNumber()));
      this.step.set('otp');
    } catch (err) {
      this.errorMessage.set(toPhoneAuthErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  async confirmOtp(): Promise<void> {
    this.errorMessage.set('');
    this.loading.set(true);
    try {
      await this.auth.confirmOtp(this.otpCode());
      await this.auth.resolveMemberSession();
      await this.router.navigate(['/talk']);
    } catch (err) {
      this.errorMessage.set(toPhoneAuthErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** auto=true は画面表示時の自動試行。ユーザー操作なしの失敗はエラー表示しない。 */
  async signInWithPasskey(auto = false): Promise<void> {
    if (!auto) {
      this.errorMessage.set('');
    }
    this.loading.set(true);
    try {
      const { customToken, credentialId } = await this.passkey.login();
      await this.auth.signInWithToken(customToken);
      if (this.auth.currentSession?.kind !== 'member') {
        await this.auth.signOut();
        throw new Error('会員用のパスキーが見つかりませんでした。');
      }
      this.passkey.markLocalPasskeyHint('member', true);
      this.passkey.markLocalCredentialId('member', credentialId);
      await this.router.navigate(['/talk']);
    } catch (err) {
      if (!auto) {
        this.errorMessage.set(toPasskeyErrorMessage(err));
      }
    } finally {
      this.loading.set(false);
    }
  }

  startPinLogin(): void {
    this.errorMessage.set('');
    this.step.set('pin');
  }

  async signInWithPin(): Promise<void> {
    this.errorMessage.set('');
    this.loading.set(true);
    try {
      const customToken = await this.pin.login('member', this.pinCode());
      await this.auth.signInWithToken(customToken);
      if (this.auth.currentSession?.kind !== 'member') {
        await this.auth.signOut();
        throw new Error('会員用のPINが見つかりませんでした。');
      }
      await this.router.navigate(['/talk']);
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
