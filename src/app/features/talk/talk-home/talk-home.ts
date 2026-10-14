import { Component, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faComments } from '@fortawesome/free-solid-svg-icons';
import { TalkLayout } from '../talk-layout/talk-layout';

/** 2列で表示する幅(talk-layout.scss の、スマホ幅に切り替える境目と揃える)。 */
const TWO_COLUMN_QUERY = '(min-width: 768px)';

/**
 * トーク(/talk)でルームを選んでいないときの右側(PC幅のみ表示。スマホ幅では一覧だけを出す)。
 * PC幅では、いちばん最近に動きがあったルームを開く(一覧は新しい順なので先頭)。
 */
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
  private readonly layout = inject(TalkLayout);
  private readonly router = inject(Router);

  readonly icon = faComments;

  constructor() {
    effect(() => {
      const latest = this.layout.threads()?.[0];
      if (latest && window.matchMedia(TWO_COLUMN_QUERY).matches) {
        // 戻るで /talk に戻って、また開き直すことにならないよう、履歴を置き換える。
        void this.router.navigate(['/talk/rooms', latest.id], { replaceUrl: true });
      }
    });
  }
}
