import { Component, input } from '@angular/core';
import type { MembershipTermsFormat } from '../../core/models/firestore.models';

/**
 * 会員条件の表示。テキストは改行を保ってそのまま、HTMLは [innerHTML] で表示する。
 * [innerHTML] は Angular が危険なタグ・属性(script、onclick、javascript: のリンク、style など)を取り除いてから
 * 表示するため、管理者が入力したHTMLをそのまま渡してよい。
 * ログイン前の会員申請の画面(/join)でも使うため、Firestore には依存させない。
 */
@Component({
  selector: 'app-membership-terms',
  template: `
    @if (format() === 'html') {
      <div class="terms html" [innerHTML]="body()"></div>
    } @else {
      <div class="terms text">{{ body() }}</div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .terms {
      max-height: 360px;
      overflow-y: auto;
      padding: 14px 16px;
      border: 1px solid #e7e5e4;
      border-radius: 10px;
      background: #fafaf9;
      font-size: 0.9rem;
      line-height: 1.7;
      color: #292524;
      word-break: break-word;
    }
    .text {
      white-space: pre-wrap;
    }
    .html :first-child {
      margin-top: 0;
    }
    .html :last-child {
      margin-bottom: 0;
    }
    .html table {
      border-collapse: collapse;
    }
    .html th,
    .html td {
      padding: 4px 8px;
      border: 1px solid #d6d3d1;
    }
    .html a {
      color: #0f766e;
    }
  `,
})
export class MembershipTermsView {
  readonly format = input.required<MembershipTermsFormat>();
  readonly body = input.required<string>();
}
