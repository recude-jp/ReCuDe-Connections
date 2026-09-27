import { Component, input, output } from '@angular/core';
import { REACTIONS } from '../../../core/utils/stamps';

/**
 * リアクションの選択肢。メッセージの横のリアクションのボタンのすぐ右(右に場所が無いときは左)に出す。
 * 押した絵文字を picked で親に伝える(自分と同じものなら、親が取り消す。1人1つ)。
 */
@Component({
  selector: 'app-reaction-picker',
  template: `
    <div class="reaction-picker" role="group" aria-label="リアクションを選ぶ">
      @for (emoji of choices; track emoji) {
        <button
          type="button"
          [class.selected]="selected() === emoji"
          [attr.aria-label]="'リアクション ' + emoji"
          (click)="picked.emit(emoji)"
        >
          {{ emoji }}
        </button>
      }
    </div>
  `,
  styles: `
    /* 親の .react-anchor(position: relative)の中で、ボタンのすぐ右に重ねて出す。to-left のときは左。 */
    :host {
      position: absolute;
      top: 50%;
      left: calc(100% + 4px);
      z-index: 5;
      transform: translateY(-50%);
    }
    :host(.to-left) {
      right: calc(100% + 4px);
      left: auto;
    }
    .reaction-picker {
      display: flex;
      gap: 2px;
      padding: 4px 6px;
      border-radius: 999px;
      background: #fff;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);
      white-space: nowrap;
    }
    button {
      padding: 2px 4px;
      border: none;
      border-radius: 8px;
      background: transparent;
      font-size: 1.3rem;
      line-height: 1.2;
      cursor: pointer;
    }
    button:hover {
      background: #f5f5f4;
    }
    button.selected {
      background: #ccfbf1;
    }
  `,
})
export class ReactionPicker {
  /** 自分が付けているリアクション。 */
  readonly selected = input<string | undefined>(undefined);
  readonly picked = output<string>();

  readonly choices = REACTIONS;
}
