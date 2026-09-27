import { Component, computed, inject, input, output, signal, effect } from '@angular/core';
import { RoomService } from '../../../core/services/room.service';
import type { MessageMedia } from '../../../core/models/firestore.models';

/** 表示するサムネイルの最大幅・最大高さ(px)。 */
const MAX_WIDTH = 240;
const MAX_HEIGHT = 320;

/**
 * 画像メッセージのサムネイル。ダウンロードURLは非同期で取得するため、読み込むまでは元の縦横比の枠を出して
 * 一覧のスクロール位置がずれないようにする。押すと拡大表示(open)を親に伝える。
 */
@Component({
  selector: 'app-message-image',
  template: `
    <button
      type="button"
      class="thumb"
      [style.width.px]="size().width"
      [style.height.px]="size().height"
      (click)="openOriginal()"
      aria-label="写真を拡大して見る"
    >
      @if (url(); as src) {
        <img [src]="src" alt="写真" />
      } @else if (failed()) {
        <span class="state">表示できません</span>
      }
    </button>
  `,
  styles: `
    .thumb {
      display: block;
      padding: 0;
      border: none;
      border-radius: 12px;
      overflow: hidden;
      background: #e7e5e4;
      cursor: zoom-in;
    }
    img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .state {
      font-size: 0.75rem;
      color: #78716c;
    }
  `,
})
export class MessageImage {
  private readonly roomService = inject(RoomService);

  readonly media = input.required<MessageMedia>();
  /** 拡大表示する元画像のURL。 */
  readonly open = output<string>();

  readonly url = signal<string | null>(null);
  readonly failed = signal(false);

  readonly size = computed(() => {
    const { width, height } = this.media();
    const scale = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height);
    return { width: Math.round(width * scale), height: Math.round(height * scale) };
  });

  constructor() {
    effect(() => {
      const thumbPath = this.media().thumbPath;
      this.roomService
        .getMediaUrl(thumbPath)
        .then((url) => this.url.set(url))
        .catch(() => this.failed.set(true));
    });
  }

  async openOriginal(): Promise<void> {
    try {
      this.open.emit(await this.roomService.getMediaUrl(this.media().path));
    } catch {
      this.failed.set(true);
    }
  }
}
