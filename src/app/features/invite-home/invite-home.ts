import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ConnectTabs } from '../../shared/connect-tabs/connect-tabs';
import { InviteTargetOption, InviteTargetPicker } from '../../shared/invite-target-picker/invite-target-picker';
import { CommunityLogo } from '../../shared/community-logo/community-logo';
import { InviteQr, InviteService } from '../../core/services/invite.service';
import { toErrorMessage } from '../../core/utils/errors';

/**
 * つながるの先頭の「招待」(/connect)。イベントなどで直接会った人に見せるQRコードと、「招待の送付」への入口を出す。QRコードを読み込んだ人は、招待リンクを開いたのと同じように参加できる(ゲストになる)。
 * QRコードは招待先(ルートコミュニティ・連携コミュニティ)ごとに1つで、作り直すまで有効。
 * 中心に招待先のロゴを重ねる(ロゴで隠れても読めるよう、誤り訂正を最も高い H にする)。
 */
@Component({
  selector: 'app-invite-home',
  imports: [RouterLink, ConnectTabs, InviteTargetPicker, CommunityLogo],
  templateUrl: './invite-home.html',
  styleUrl: './invite-home.scss',
})
export class InviteHome {
  private readonly inviteService = inject(InviteService);

  /** 選んでいる招待先。 */
  readonly target = signal<InviteTargetOption | null>(null);
  readonly qr = signal<InviteQr | null>(null);
  /** QRコードの画像(SVGのデータURL)。 */
  readonly qrImage = signal<string | null>(null);
  readonly loading = signal(true);
  readonly regenerating = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  /** 招待先を切り替えたら、その招待先のQRコードを出す(切り替えが続いたときは、最後に選んだものだけを出す)。 */
  onTargetChange(option: InviteTargetOption): void {
    this.target.set(option);
    this.qr.set(null);
    this.qrImage.set(null);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.loading.set(true);
    this.inviteService
      .getMyInviteQr(option.target)
      .then((qr) => (this.target() === option ? this.show(qr) : undefined))
      .catch((err) => this.target() === option && this.errorMessage.set(toErrorMessage(err)))
      .finally(() => this.target() === option && this.loading.set(false));
  }

  async regenerate(): Promise<void> {
    const option = this.target();
    if (!option) {
      return;
    }
    const confirmed = window.confirm(
      `「${option.name}」への招待のQRコードを作り直します。\n\nこれまでのQRコード（印刷したもの・写真に撮られたものを含む）は使えなくなります。` +
        'すでに参加した人には影響ありません。\n\nよろしいですか？',
    );
    if (!confirmed) {
      return;
    }
    this.errorMessage.set('');
    this.successMessage.set('');
    this.regenerating.set(true);
    try {
      await this.show(await this.inviteService.regenerateInviteQr(option.target));
      this.successMessage.set('QRコードを作り直しました。');
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.regenerating.set(false);
    }
  }

  private async show(qr: InviteQr): Promise<void> {
    // QRコードのライブラリは、この画面を開いたときだけ読み込む(初回の読み込みを小さく保つため)。
    const { toString } = await import('qrcode');
    // 誤り訂正 H は約30%まで欠けても読める。中心のロゴ(QRコードの面積の約5%)で隠れる分を補う。
    const svg = await toString(qr.url, { type: 'svg', errorCorrectionLevel: 'H', margin: 1, width: 240 });
    this.qr.set(qr);
    this.qrImage.set(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  }
}
