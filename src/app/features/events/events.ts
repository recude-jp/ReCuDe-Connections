import { Component } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faCalendarDays } from '@fortawesome/free-solid-svg-icons';

/** メイン機能「イベント」(/events)。リアルイベント機能(SPEC 6章・Step 6)までの仮画面。 */
@Component({
  selector: 'app-events',
  imports: [FaIconComponent],
  templateUrl: './events.html',
  styleUrl: './events.scss',
})
export class Events {
  readonly icon = faCalendarDays;
}
