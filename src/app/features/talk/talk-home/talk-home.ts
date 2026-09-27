import { Component } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faComments } from '@fortawesome/free-solid-svg-icons';

/** トーク(/talk)でルームを選んでいないときの右側(PC幅のみ表示。スマホ幅では一覧だけを出す)。 */
@Component({
  selector: 'app-talk-home',
  imports: [FaIconComponent],
  template: `
    <div class="talk-home">
      <fa-icon [icon]="icon" class="icon" />
      <p>左の一覧からトークを選んでください。</p>
    </div>
  `,
  styles: `
    .talk-home {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #a8a29e;
    }
    .icon {
      font-size: 3rem;
      margin-bottom: 8px;
    }
  `,
})
export class TalkHome {
  readonly icon = faComments;
}
