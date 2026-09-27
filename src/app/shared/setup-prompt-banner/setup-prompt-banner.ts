import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PasskeyKind, PasskeyService } from '../../core/services/passkey.service';
import { PinService } from '../../core/services/pin.service';

const DISMISSED_KEY_PREFIX = 'recude-match:hide-setup-prompt:';

/**
 * ログイン中、この端末にパスキーもPINも未設定のときに表示する設定案内バナー。
 * 「次回から表示しない」はlocalStorageに永続化する(端末・ブラウザ単位)。
 */
@Component({
  selector: 'app-setup-prompt-banner',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './setup-prompt-banner.html',
  styleUrl: './setup-prompt-banner.scss',
})
export class SetupPromptBanner {
  private readonly passkeyService = inject(PasskeyService);
  private readonly pinService = inject(PinService);

  readonly kind = input.required<PasskeyKind>();
  readonly settingsLink = input.required<string>();

  private readonly closedThisSession = signal(false);
  /** neverShowAgain()での書き込み後にvisible()を再評価させるためのトリガー。 */
  private readonly dismissedVersion = signal(0);

  readonly visible = computed(() => {
    this.dismissedVersion();
    const kind = this.kind();
    const hasPasskey = this.passkeyService.isSupported() && this.passkeyService.hasLocalPasskeyHint(kind);
    const hasPin = this.pinService.isLocalPinConfigured(kind);
    const dismissedPermanently = localStorage.getItem(DISMISSED_KEY_PREFIX + kind) === '1';
    return !hasPasskey && !hasPin && !this.closedThisSession() && !dismissedPermanently;
  });

  close(): void {
    this.closedThisSession.set(true);
  }

  neverShowAgain(): void {
    localStorage.setItem(DISMISSED_KEY_PREFIX + this.kind(), '1');
    this.dismissedVersion.update((v) => v + 1);
  }
}
