import { Component, HostListener, input, output } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';

/** 写真の拡大表示。背景・閉じるボタン・Escキーで閉じる。 */
@Component({
  selector: 'app-image-viewer',
  imports: [FaIconComponent],
  template: `
    <div class="lightbox" role="dialog" aria-label="写真" (click)="closed.emit()">
      <button type="button" class="lightbox-close" aria-label="閉じる"><fa-icon [icon]="closeIcon" /></button>
      <img [src]="url()" alt="写真" (click)="$event.stopPropagation()" />
    </div>
  `,
  styleUrl: './image-viewer.scss',
})
export class ImageViewer {
  readonly url = input.required<string>();
  readonly closed = output<void>();
  readonly closeIcon = faXmark;

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }
}
