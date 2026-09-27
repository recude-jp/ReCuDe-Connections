import { Component, computed, input } from '@angular/core';

/**
 * 件数のバッジ(未読のメッセージ・審査待ちの申請など)。親(position: relative)の左上に重ねて出す。
 * 0件のときは何も出さない。100件以上は「99+」。
 */
@Component({
  selector: 'app-count-badge',
  template: `
    @if (count() > 0) {
      <span class="badge" [attr.aria-label]="label() + ' ' + count() + '件'">{{ text() }}</span>
    }
  `,
  styles: `
    :host {
      position: absolute;
      top: -6px;
      left: -8px;
      z-index: 1;
      pointer-events: none;
    }
    .badge {
      display: inline-block;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      box-sizing: border-box;
      border: 2px solid #fff;
      border-radius: 999px;
      background: #dc2626;
      color: #fff;
      font-size: 0.65rem;
      font-weight: 700;
      line-height: 14px;
      text-align: center;
      white-space: nowrap;
    }
  `,
})
export class CountBadge {
  readonly count = input(0);
  /** 読み上げ用の説明(例: 未読)。 */
  readonly label = input('');

  readonly text = computed(() => (this.count() > 99 ? '99+' : String(this.count())));
}
