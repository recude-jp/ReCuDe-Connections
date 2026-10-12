import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faFingerprint, faKey, faLock } from '@fortawesome/free-solid-svg-icons';
import { E2eeService } from '../../../core/services/e2ee.service';
import { isPrfLikelySupported } from '../../../core/crypto/e2ee-passkey';
import { toPasskeyErrorMessage } from '../../../core/utils/errors';

/**
 * intro: 初めて使うときの説明。code: 回復コードの表示。passkey: この端末のパスキーで守るか。
 * restore: 新しい端末で、パスキーで戻す。recovery: 回復コードを入力して戻す。reset: 控えを失ったときの作り直しの確認。
 */
type Step = 'intro' | 'code' | 'passkey' | 'restore' | 'recovery' | 'reset';

/**
 * トークを使う前の、暗号鍵の準備(SECURITY-DEVELOPMENT.md 6-3)。
 * 初めて使うときは鍵を作り、回復コード(一度だけ表示)と、この端末のパスキーで守る。
 * 新しい端末では、引き継がれたパスキーか回復コードで鍵を戻す。どちらも無いときは作り直せる(これまでの会話は読めなくなる)。
 */
@Component({
  selector: 'app-e2ee-gate',
  imports: [FormsModule, FaIconComponent],
  templateUrl: './e2ee-gate.html',
  styleUrl: './e2ee-gate.scss',
})
export class E2eeGate {
  private readonly e2ee = inject(E2eeService);

  readonly icons = { lock: faLock, fingerprint: faFingerprint, key: faKey };
  readonly state = this.e2ee.state;
  readonly hasPasskeyBackup = this.e2ee.hasPasskeyBackup;

  /** 画面の中の段階(state が needs-setup・needs-restore のときに使う)。 */
  private readonly chosenStep = signal<Step | null>(null);
  readonly step = computed<Step>(() => this.chosenStep() ?? (this.state() === 'needs-restore' ? 'restore' : 'intro'));

  readonly recoveryCode = signal('');
  readonly savedCode = signal(false);
  readonly codeInput = signal('');
  readonly resetUnderstood = signal(false);
  /** パスキーで守る段階が、作り直し・初めて(setup)か、回復コードで戻したあと(restore)か。 */
  readonly passkeyContext = signal<'setup' | 'restore'>('setup');
  readonly copied = signal(false);
  readonly busy = signal(false);
  readonly errorMessage = signal('');

  /** 回復コードを作って表示する(初めて・作り直し)。 */
  async start(): Promise<void> {
    await this.run(async () => {
      this.recoveryCode.set(await this.e2ee.beginSetup());
      this.savedCode.set(false);
      this.copied.set(false);
      this.chosenStep.set('code');
    });
  }

  async copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.recoveryCode());
      this.copied.set(true);
    } catch {
      this.copied.set(false);
    }
  }

  /** 回復コードを保管したら、この端末のパスキーで守る段階へ(パスキーの PRF を使えない端末なら、そのまま始める)。 */
  async afterCode(): Promise<void> {
    if (!this.savedCode()) {
      return;
    }
    this.passkeyContext.set('setup');
    if (await isPrfLikelySupported()) {
      this.chosenStep.set('passkey');
    } else {
      await this.run(() => this.e2ee.finishPending());
    }
  }

  /** この端末のパスキーで守って、使い始める。 */
  async protectWithPasskey(): Promise<void> {
    await this.run(async () => {
      await this.e2ee.protectPendingWithPasskey();
      await this.e2ee.finishPending();
    });
  }

  /** パスキーでは守らずに使い始める(回復コードだけで守る)。 */
  async skipPasskey(): Promise<void> {
    await this.run(() => this.e2ee.finishPending());
  }

  async restoreWithPasskey(): Promise<void> {
    await this.run(() => this.e2ee.restoreWithPasskey());
  }

  async restoreWithCode(): Promise<void> {
    if (!this.codeInput().trim()) {
      return;
    }
    await this.run(async () => {
      await this.e2ee.beginRestoreWithRecoveryCode(this.codeInput());
      this.codeInput.set('');
      this.passkeyContext.set('restore');
      if (await isPrfLikelySupported()) {
        this.chosenStep.set('passkey');
      } else {
        await this.e2ee.finishPending();
      }
    });
  }

  goTo(step: Step): void {
    this.errorMessage.set('');
    if (step === 'restore' || step === 'intro') {
      this.e2ee.cancelPending();
    }
    this.resetUnderstood.set(false);
    this.chosenStep.set(step);
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.errorMessage.set('');
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
