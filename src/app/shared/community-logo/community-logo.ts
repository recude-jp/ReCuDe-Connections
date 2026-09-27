import { Component, computed, input } from '@angular/core';
import { ICON_TEXT_MAX, iconChars } from '../../core/utils/icon-text';

/**
 * 連携コミュニティのロゴ(SPEC 9章)。ロゴが未設定なら丸いアイコンに文字を出す。
 * 管理者が「ロゴの代わりの文字」(text、2文字まで)を決めていればその文字(同じ大きさ)、なければ名称の頭文字。
 */
@Component({
  selector: 'app-community-logo',
  template: `
    @if (logoUrl(); as url) {
      <img [src]="url" alt="" [style.width.px]="size()" [style.height.px]="size()" />
    } @else {
      <span
        class="initial"
        [style.width.px]="size()"
        [style.height.px]="size()"
        [style.font-size.px]="size() * (initial().length > 1 ? 0.36 : 0.45)"
      >
        {{ initial() }}
      </span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-shrink: 0;
    }
    img {
      display: block;
      object-fit: contain;
      border-radius: 6px;
    }
    .initial {
      display: inline-grid;
      place-items: center;
      border-radius: 50%;
      background: #e0f2fe;
      color: #075985;
      font-weight: 700;
      line-height: 1;
    }
  `,
  host: { '[attr.title]': 'nativeTitle() ? name() : null' },
})
export class CommunityLogo {
  readonly name = input.required<string>();
  readonly logoUrl = input<string | null | undefined>(null);
  readonly size = input(28);
  /** ロゴの代わりの文字(Community.logoText)。 */
  readonly text = input<string | null | undefined>(null);
  /** ブラウザ標準のツールチップ(title)を出すか。独自のツールチップを付ける場所(ヘッダ)では false にする。 */
  readonly nativeTitle = input(true);

  readonly initial = computed(() => {
    const custom = iconChars(this.text()).slice(0, ICON_TEXT_MAX).join('');
    return custom || (iconChars(this.name())[0] ?? '?');
  });
}
