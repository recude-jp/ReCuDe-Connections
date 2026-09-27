import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { MemberService } from '../../core/services/member.service';
import { ICON_TEXT_MAX, iconChars } from '../../core/utils/icon-text';

/**
 * 会員のプロフィール画像。未設定・読み込めないときは丸の中に文字を出す。
 * - 本人が「アイコンの文字」(text、2文字まで)を決めていれば、その文字を同じ大きさで出す。
 * - 決めていなければ、名前の最初の1文字(大きく)と最後の1文字(小さく)を出す(例: 佐藤花子 → 「佐」「子」)。
 */
@Component({
  selector: 'app-member-avatar',
  template: `
    <span class="avatar" [style.width.px]="size()" [style.height.px]="size()" [style.font-size.px]="size() * 0.42">
      @if (url(); as src) {
        <img [src]="src" [alt]="name() + 'さんのプロフィール画像'" />
      } @else {
        @if (customText(); as custom) {
          <span class="initials" aria-hidden="true" [style.font-size.px]="size() * (custom.length > 1 ? 0.34 : 0.42)">
            {{ custom }}
          </span>
        } @else {
          <span class="initials" aria-hidden="true">
            <span class="first">{{ first() }}</span>
            @if (last(); as lastChar) {
              <span class="last" [style.font-size.px]="size() * 0.26">{{ lastChar }}</span>
            }
          </span>
        }
      }
    </span>
  `,
  styles: `
    :host {
      display: inline-block;
      flex: 0 0 auto;
    }
    .avatar {
      display: grid;
      place-items: center;
      border-radius: 50%;
      overflow: hidden;
      background: #e7e5e4;
      color: #57534e;
      font-weight: 700;
    }
    .initials {
      display: flex;
      align-items: baseline;
      line-height: 1;
    }
    .last {
      margin-left: 0.05em;
      font-weight: 600;
      opacity: 0.85;
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `,
})
export class MemberAvatar {
  private readonly memberService = inject(MemberService);

  readonly photoPath = input<string | undefined | null>(null);
  readonly name = input('');
  readonly size = input(40);
  /** 本人が決めたアイコンの文字(Member.avatarText)。 */
  readonly text = input<string | null | undefined>(null);

  readonly customText = computed(() => iconChars(this.text()).slice(0, ICON_TEXT_MAX).join(''));
  /** 名前の文字(空白を除く。絵文字など2つの符号で1文字のものも1文字として数える)。 */
  private readonly chars = computed(() => iconChars(this.name()));
  readonly first = computed(() => this.chars()[0] ?? '？');
  /** 最後の1文字(名前が1文字のときは出さない)。 */
  readonly last = computed(() => (this.chars().length >= 2 ? this.chars()[this.chars().length - 1] : ''));
  readonly url = signal<string | null>(null);

  constructor() {
    effect(() => {
      const path = this.photoPath();
      this.url.set(null);
      if (path) {
        this.memberService
          .getPhotoUrl(path)
          .then((url) => {
            if (this.photoPath() === path) {
              this.url.set(url);
            }
          })
          .catch(() => undefined);
      }
    });
  }
}
