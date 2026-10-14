import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faCommentSms, faEnvelope, faFingerprint } from '@fortawesome/free-solid-svg-icons';
import { AuthService } from '../../core/services/auth.service';
import { PublicBrandingService } from '../../core/services/public-branding.service';
import { FaviconService } from '../../core/services/favicon.service';
import { Title } from '@angular/platform-browser';
import { DEFAULT_SITE_TITLE } from '../../core/utils/branding';
import { PasskeyService } from '../../core/services/passkey.service';
import { PinService } from '../../core/services/pin.service';
import { LoginChannel, LoginChannels, LoginService } from '../../core/services/login.service';
import { PinInput } from '../../shared/pin-input/pin-input';
import { Spinner } from '../../shared/spinner/spinner';
import { isAlreadyRegisteredError, toErrorMessage, toPasskeyErrorMessage } from '../../core/utils/errors';
import { environment } from '../../../environments/environment';

/**
 * identifier: ログインIDの入力。channel: 認証コードの送り先(メール・SMS)の選択。otp: 認証コードの入力。
 * pin: この端末のPINでのログイン。
 */
type Step = 'identifier' | 'channel' | 'otp' | 'pin';

/** 認証コードでログインしたあと、トークに移る前に出すダイアログ(ログインIDの設定 → パスキーの登録)。 */
type SetupStep = 'login-id' | 'passkey';

/**
 * 会員ログイン(/login)。ログインIDを入力し、この端末でそのIDのパスキーを使ったことがあればパスキーで、
 * なければ登録されているメール・SMSに送る認証コードでログインする(SPEC 1章「ログイン方式の変更」)。
 */
@Component({
  selector: 'app-member-login',
  imports: [FormsModule, PinInput, FaIconComponent, RouterLink, Spinner],
  templateUrl: './member-login.html',
  styleUrl: './member-login.scss'
})
export class MemberLogin {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly publicBranding = inject(PublicBrandingService);
  private readonly favicon = inject(FaviconService);
  private readonly titleService = inject(Title);
  private readonly passkey = inject(PasskeyService);
  private readonly pin = inject(PinService);
  private readonly login = inject(LoginService);

  readonly faEnvelope = faEnvelope;
  readonly faCommentSms = faCommentSms;
  readonly faFingerprint = faFingerprint;

  readonly step = signal<Step>('identifier');
  readonly identifier = signal('');
  readonly channels = signal<LoginChannels>({ email: false, sms: false });
  readonly sentChannel = signal<LoginChannel | null>(null);
  readonly otpCode = signal('');
  readonly pinCode = signal('');
  readonly loading = signal(false);
  /** 処理中の操作(押したボタンにだけスピナーを出す)。 */
  readonly busy = signal<string | null>(null);
  readonly errorMessage = signal('');
  /** 入力したIDのパスキーを自動で試すか(この端末でそのIDのパスキーを使ったことがある)。 */
  readonly canTryPasskey = signal(false);
  /** パスキーでログインのボタンを出すか(端末の記録が消えていても使えるよう、対応している端末では常に出す)。 */
  readonly passkeySupported = this.passkey.isSupported();
  readonly pinSupported = signal(this.pin.isLocalPinConfigured('member'));

  readonly setupStep = signal<SetupStep | null>(null);
  readonly newLoginId = signal('');
  private readonly offerPasskey = signal(false);

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

  /** ログインIDを入力して「次へ」。パスキーを使ったことがあれば先に試し、だめなら送り先の選択へ。 */
  async submitIdentifier(): Promise<void> {
    const identifier = this.identifier().trim();
    if (!identifier) {
      return;
    }
    this.errorMessage.set('');
    this.busy.set('next');
    this.loading.set(true);
    try {
      this.channels.set(await this.login.start(identifier));
      this.canTryPasskey.set(this.passkey.shouldTryPasskeyFor(identifier));
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
      return;
    } finally {
      this.loading.set(false);
    }
    this.step.set('channel');
    if (this.canTryPasskey()) {
      await this.signInWithPasskey();
    }
  }

  async signInWithPasskey(): Promise<void> {
    const identifier = this.identifier().trim();
    this.errorMessage.set('');
    this.busy.set('passkey');
    this.loading.set(true);
    try {
      const { customToken, credentialId } = await this.passkey.login(identifier);
      await this.auth.signInWithToken(customToken);
      if (this.auth.currentSession?.kind !== 'member') {
        await this.auth.signOut();
        throw new Error('会員用のパスキーが見つかりませんでした。');
      }
      this.passkey.markLocalPasskeyHint('member', true);
      this.passkey.markLocalCredentialId('member', credentialId);
      this.passkey.rememberPasskeyFor([identifier]);
      await this.router.navigate(['/talk']);
    } catch (err) {
      // 送り先の選択の画面のまま、認証コードでもログインできるようにする。
      this.errorMessage.set(toPasskeyErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  async sendCode(channel: LoginChannel): Promise<void> {
    this.errorMessage.set('');
    this.busy.set(channel);
    this.loading.set(true);
    try {
      await this.login.sendCode(this.identifier().trim(), channel);
      this.sentChannel.set(channel);
      this.otpCode.set('');
      this.step.set('otp');
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  async confirmOtp(): Promise<void> {
    const identifier = this.identifier().trim();
    this.errorMessage.set('');
    this.busy.set('otp');
    this.loading.set(true);
    try {
      const { customToken, needsLoginId, hasPasskey } = await this.login.verifyCode(identifier, this.otpCode());
      await this.auth.signInWithToken(customToken);
      if (this.auth.currentSession?.kind !== 'member') {
        await this.auth.signOut();
        throw new Error('ログインに失敗しました。');
      }
      // パスキーをまだ登録していなければ、トークに移る前に登録を勧める。登録済みなら勧めず、
      // 次回からこのIDでパスキーを試す(iPhoneなどで端末の記録が消えても、毎回登録を聞かないように)。
      if (hasPasskey) {
        this.passkey.rememberPasskeyFor([identifier]);
      }
      this.offerPasskey.set(
        this.passkey.isSupported() && !hasPasskey && !this.passkey.shouldTryPasskeyFor(identifier),
      );
      if (needsLoginId) {
        this.setupStep.set('login-id');
      } else if (this.offerPasskey()) {
        this.setupStep.set('passkey');
      } else {
        await this.router.navigate(['/talk']);
      }
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** 認証コードの入力から、送り先の選択に戻る(送り直す・別の送り先にする)。 */
  backToChannels(): void {
    this.errorMessage.set('');
    this.step.set('channel');
  }

  /** ログインIDの入力に戻る。 */
  changeIdentifier(): void {
    this.errorMessage.set('');
    this.otpCode.set('');
    this.step.set('identifier');
  }

  startPinLogin(): void {
    this.errorMessage.set('');
    this.step.set('pin');
  }

  async signInWithPin(): Promise<void> {
    this.errorMessage.set('');
    this.busy.set('pin');
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

  /** ダイアログ: ログインIDが未設定の会員(電話番号でログインした人)に、ログインIDを決めてもらう。 */
  async saveLoginId(): Promise<void> {
    const loginId = this.newLoginId().trim();
    if (!loginId) {
      return;
    }
    this.errorMessage.set('');
    this.busy.set('loginId');
    this.loading.set(true);
    try {
      const saved = await this.login.setLoginId(loginId);
      // 次回からは、このログインIDを入力すればこの端末のパスキーを試せるようにする。
      if (!this.offerPasskey()) {
        this.passkey.rememberPasskeyFor([saved]);
      }
      this.identifier.set(saved);
      await this.afterLoginIdStep();
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  async skipLoginId(): Promise<void> {
    this.errorMessage.set('');
    await this.afterLoginIdStep();
  }

  private async afterLoginIdStep(): Promise<void> {
    if (this.offerPasskey()) {
      this.setupStep.set('passkey');
    } else {
      await this.finishSetup();
    }
  }

  /** ダイアログ: この端末にパスキーを登録して、トークへ。 */
  async registerPasskey(): Promise<void> {
    this.errorMessage.set('');
    this.busy.set('register');
    this.loading.set(true);
    try {
      await this.passkey.register('member');
      this.passkey.markLocalPasskeyHint('member', true);
      this.passkey.rememberPasskeyFor([this.identifier().trim()]);
      await this.finishSetup();
    } catch (err) {
      // この端末にはすでにパスキーがある(別の端末で登録したものが同期されていることもある)。
      // 次回からそれでログインできるよう記録して、そのまま進む。
      if (isAlreadyRegisteredError(err)) {
        this.passkey.markLocalPasskeyHint('member', true);
        this.passkey.rememberPasskeyFor([this.identifier().trim()]);
        await this.finishSetup();
        return;
      }
      this.errorMessage.set(toPasskeyErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  async finishSetup(): Promise<void> {
    this.errorMessage.set('');
    this.setupStep.set(null);
    await this.router.navigate(['/talk']);
  }
}
