import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/services/auth.service';
import { PasskeyService, PasskeyCredentialSummary } from '../../core/services/passkey.service';
import { PinService, PinDeviceSummary } from '../../core/services/pin.service';
import { PinInput } from '../../shared/pin-input/pin-input';
import { toErrorMessage, toPasskeyErrorMessage } from '../../core/utils/errors';

const PIN_REGEX = /^\d{6}$/;

/**
 * マイページの「ログイン設定」タブ(/mypage/passkeys)。会員(管理者を含む)のパスキー・PINを管理する。
 */
@Component({
  selector: 'app-passkey-settings',
  imports: [FormsModule, PinInput],
  templateUrl: './passkey-settings.html',
  styleUrl: './passkey-settings.scss',
})
export class PasskeySettings {
  private readonly auth = inject(AuthService);
  private readonly passkeyService = inject(PasskeyService);
  private readonly pinService = inject(PinService);

  readonly session = toSignal(this.auth.session$, { initialValue: undefined });


  readonly passkeySupported = signal(this.passkeyService.isSupported());
  readonly credentials = signal<PasskeyCredentialSummary[] | undefined>(undefined);
  readonly deviceLabel = signal('');
  readonly registering = signal(false);
  readonly removingId = signal<string | null>(null);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  /**
   * このブラウザが最後に登録/ログインに使ったパスキーのcredentialId(一覧中の「本端末」判定に使う)。
   * localStorageの読み取りはシグナルの変化を検知できないため、書き込みの都度この signal 自体を
   * 更新する(register/remove時)。ここでは初回のセッション確定時の読み込みのみ担う。
   */
  readonly localCredentialId = signal<string | null>(null);

  /** 本端末のcredentialIdがサーバー側の一覧にまだ存在するか(削除済みなら未登録として扱う)。 */
  readonly deviceAlreadyRegistered = computed(() => {
    const localId = this.localCredentialId();
    const rows = this.credentials();
    return !!localId && !!rows?.some((credential) => credential.credentialId === localId);
  });

  readonly pinDevices = signal<PinDeviceSummary[] | undefined>(undefined);
  readonly newPin = signal('');
  readonly pinDeviceLabel = signal('');
  readonly settingUpPin = signal(false);
  readonly removingPinDeviceId = signal<string | null>(null);

  /** register/remove後の再取得と初回取得が競合したとき、古い結果で新しい結果を上書きしないためのトークン。 */
  private loadToken = 0;
  private pinLoadToken = 0;

  constructor() {
    effect(() => {
      const kind = this.session()?.kind;
      this.localCredentialId.set(
        kind === 'member' ? this.passkeyService.getLocalCredentialId(kind) : null,
      );
    });
    void this.load();
    void this.loadPin();
  }

  private async load(): Promise<void> {
    const token = ++this.loadToken;
    try {
      const credentials = await this.passkeyService.list();
      if (token !== this.loadToken) {
        return;
      }
      this.credentials.set(credentials);

      // サーバー側の実際の登録件数で、ログイン画面のボタン表示に使うローカルな記録を同期させる。
      const kind = this.session()?.kind;
      if (kind === 'member') {
        this.passkeyService.markLocalPasskeyHint(kind, credentials.length > 0);
      }
    } catch (err) {
      if (token === this.loadToken) {
        this.errorMessage.set(toErrorMessage(err));
      }
    }
  }

  async register(): Promise<void> {
    const kind = this.session()?.kind;
    if (kind !== 'member') {
      return;
    }

    this.errorMessage.set('');
    this.successMessage.set('');
    this.registering.set(true);
    try {
      const credentialId = await this.passkeyService.register(kind, this.deviceLabel().trim() || undefined);
      this.localCredentialId.set(credentialId);
      this.deviceLabel.set('');
      this.successMessage.set('パスキーを登録しました。');
      await this.load();
    } catch (err) {
      this.errorMessage.set(toPasskeyErrorMessage(err));
    } finally {
      this.registering.set(false);
    }
  }

  formatDate(isoString: string): string {
    return new Date(isoString).toLocaleString('ja-JP');
  }

  async remove(credentialId: string, deviceLabel: string): Promise<void> {
    // このアプリの記録を消してもログインには使えなくなるだけで、端末・パスワードマネージャー側の
    // パスキー本体は自動削除されない(Webサイトにはそれを消す手段がない)ため、事前に案内する。
    const confirmed = window.confirm(
      `「${deviceLabel}」を削除します。\n\n` +
        'この操作で削除されるのはこのアプリ側の登録情報のみです。' +
        'お使いの端末やパスワードマネージャーに保存されたパスキー自体は自動的には削除されません。' +
        '完全に削除したい場合は、端末側の設定からも別途削除してください。\n\n' +
        '削除してよろしいですか？',
    );
    if (!confirmed) {
      return;
    }

    this.errorMessage.set('');
    this.successMessage.set('');
    this.removingId.set(credentialId);
    try {
      await this.passkeyService.remove(credentialId);
      if (this.localCredentialId() === credentialId) {
        this.localCredentialId.set(null);
      }
      await this.load();
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.removingId.set(null);
    }
  }

  private async loadPin(): Promise<void> {
    const token = ++this.pinLoadToken;
    try {
      const devices = await this.pinService.list();
      if (token !== this.pinLoadToken) {
        return;
      }
      this.pinDevices.set(devices);
    } catch (err) {
      if (token === this.pinLoadToken) {
        this.errorMessage.set(toErrorMessage(err));
      }
    }
  }

  async setupPin(): Promise<void> {
    const kind = this.session()?.kind;
    if (kind !== 'member') {
      return;
    }
    if (!PIN_REGEX.test(this.newPin())) {
      this.errorMessage.set('PINは6桁の数字で指定してください。');
      return;
    }

    this.errorMessage.set('');
    this.successMessage.set('');
    this.settingUpPin.set(true);
    try {
      await this.pinService.setup(kind, this.newPin(), this.pinDeviceLabel().trim() || undefined);
      this.newPin.set('');
      this.pinDeviceLabel.set('');
      this.successMessage.set('この端末にPINログインを設定しました。');
      await this.loadPin();
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.settingUpPin.set(false);
    }
  }

  async removePinDevice(deviceId: string): Promise<void> {
    this.errorMessage.set('');
    this.successMessage.set('');
    this.removingPinDeviceId.set(deviceId);
    try {
      await this.pinService.remove(deviceId);
      await this.loadPin();
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.removingPinDeviceId.set(null);
    }
  }
}
