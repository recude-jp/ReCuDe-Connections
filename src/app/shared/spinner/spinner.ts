import { Component } from '@angular/core';

/** 処理中を表すくるくる(ボタンの文字の前などに置く。色は文字の色に合わせる)。 */
@Component({
  selector: 'app-spinner',
  template: '',
  host: { role: 'status', 'aria-label': '処理しています' },
  styles: `
    :host {
      display: inline-block;
      width: 1em;
      height: 1em;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      vertical-align: -0.15em;
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      :host {
        animation-duration: 2s;
      }
    }
  `,
})
export class Spinner {}
