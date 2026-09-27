import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../core/services/admin.service';
import { AdminScopeService } from '../../core/services/admin-scope.service';
import type { MembershipTerms, MembershipTermsFormat } from '../../core/models/firestore.models';
import { MembershipTermsView } from '../../shared/membership-terms/membership-terms';
import { formatDate } from '../../core/utils/dates';
import { toErrorMessage } from '../../core/utils/errors';

const BODY_MAX = 20000;

/** 形式を切り替えたときの書き始めの例。 */
const EXAMPLES: Record<MembershipTermsFormat, string> = {
  text: `東京岐阜県人会の会員になるには、次の条件があります。

・岐阜県出身、または岐阜県にゆかりのある方
・年会費 2,000円（毎年4月に事務局からご案内します）

会費のお支払いが確認できた時点で、正会員となります。`,
  html: `<h3>会員の条件</h3>
<ul>
  <li>岐阜県出身、または岐阜県にゆかりのある方</li>
  <li>年会費 <strong>2,000円</strong>（毎年4月に事務局からご案内します）</li>
</ul>
<p>会費のお支払いが確認できた時点で、正会員となります。</p>`,
};

/**
 * 管理画面の会員条件(/admin/:scope/membership-terms)。会員になるための条件や年会費などの説明を、
 * テキストかHTMLで入力する。会員申請の画面に表示され、設定により同意を求める。
 * 連携コミュニティでは参加の条件(招待から参加する画面に表示)と、参加に管理者の承認を必要とするかを設定する。
 */
@Component({
  selector: 'app-admin-membership-terms',
  imports: [FormsModule, MembershipTermsView],
  templateUrl: './admin-membership-terms.html',
  styleUrl: './admin-membership-terms.scss',
})
export class AdminMembershipTerms {
  private readonly adminService = inject(AdminService);
  readonly scopes = inject(AdminScopeService);

  readonly bodyMax = BODY_MAX;
  readonly formatDate = formatDate;

  readonly format = signal<MembershipTermsFormat>('text');
  readonly body = signal('');
  readonly requireAgreement = signal(true);
  /** 連携コミュニティだけ: 参加に管理者の承認を必要とするか。 */
  readonly requireApproval = signal(false);
  /** フォームに反映した対象(対象を切り替えたら読み込み直す)。 */
  private initializedKey: string | null = null;
  /** 保存済みの内容(未保存の変更があるかの判定に使う。computed が追従するよう signal にする)。 */
  private readonly savedJson = signal('');

  readonly saving = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  readonly dirty = computed(() => this.snapshot() !== this.savedJson());

  private snapshot(): string {
    return JSON.stringify([this.format(), this.body().trim(), this.requireAgreement(), this.requireApproval()]);
  }

  constructor() {
    // 対象の設定が届いた最初の1回だけ、フォームに反映する(保存前の入力を上書きしないため)。
    effect(() => {
      const key = this.scopes.key();
      const terms = this.scopes.membershipTerms();
      if (terms !== undefined && this.initializedKey !== key) {
        this.initializedKey = key;
        this.errorMessage.set('');
        this.successMessage.set('');
        this.reset(terms);
      }
    });
  }

  private reset(terms: MembershipTerms | null): void {
    this.requireApproval.set(this.scopes.community()?.requireApproval === true);
    this.format.set(terms?.format ?? 'text');
    this.body.set(terms?.body ?? '');
    this.requireAgreement.set(terms?.requireAgreement ?? true);
    this.savedJson.set(this.snapshot());
  }

  /** 本文が空のときだけ、書き始めの例を入れる。 */
  insertExample(): void {
    if (!this.body().trim()) {
      this.body.set(EXAMPLES[this.format()]);
    }
  }

  discard(): void {
    this.errorMessage.set('');
    this.successMessage.set('');
    const terms = this.scopes.membershipTerms();
    if (terms !== undefined) {
      this.reset(terms);
    }
  }

  async save(): Promise<void> {
    this.errorMessage.set('');
    this.successMessage.set('');
    this.saving.set(true);
    try {
      const community = this.scopes.isCommunity();
      await this.adminService.updateMembershipTerms(this.scopes.scope(), {
        format: this.format(),
        body: this.body(),
        requireAgreement: this.requireAgreement(),
        ...(community ? { requireApproval: this.requireApproval() } : {}),
      });
      this.savedJson.set(this.snapshot());
      this.successMessage.set(
        !this.body().trim()
          ? `${community ? '参加の条件' : '会員条件'}を外しました。`
          : community
            ? '参加の条件を保存しました。招待から参加する画面に表示されます。'
            : '会員条件を保存しました。会員申請の画面に表示されます。',
      );
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
