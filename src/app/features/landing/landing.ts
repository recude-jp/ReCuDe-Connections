import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { toSignal } from '@angular/core/rxjs-interop';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faLock } from '@fortawesome/free-solid-svg-icons';
import { AuthService } from '../../core/services/auth.service';
import { PublicBrandingService } from '../../core/services/public-branding.service';
import { FaviconService } from '../../core/services/favicon.service';
import { environment } from '../../../environments/environment';

/** 初期テナント(東京岐阜県人会)のサービス名。テナントの設定が読めないときに使う。 */
const FALLBACK_SERVICE_NAME = 'TOKYO GIFU CONNECT';
const FALLBACK_ORGANIZATION = '東京岐阜県人会';

/**
 * トップページ(/・/about)。ログイン前に誰でも見られる、サービスの紹介。
 * 20〜30代には「不特定多数のSNSではなく、信頼できる岐阜のネットワークの中で本当のつながりをつくれる」こと、
 * 30〜40代には「人生に大切な人脈を形成できる」ことを伝える。秘匿性(メッセージの暗号化・個人情報を同意なく公開しない)を大きな特徴として出す。
 * 文面は初期テナント(東京岐阜県人会)向け。サービス名・組織名・ロゴはテナントの設定から出す。
 * イラストは Adobe Stock で購入したもの(AdobeStock_1434716946。public/landing/ に切り出して置く)。
 */
@Component({
  selector: 'app-landing',
  imports: [RouterLink, FaIconComponent],
  templateUrl: './landing.html',
  styleUrl: './landing.scss',
})
export class Landing {
  private readonly auth = inject(AuthService);
  private readonly publicBranding = inject(PublicBrandingService);
  private readonly favicon = inject(FaviconService);
  private readonly titleService = inject(Title);

  readonly icons = { lock: faLock };

  readonly serviceName = signal(FALLBACK_SERVICE_NAME);
  readonly organization = signal(FALLBACK_ORGANIZATION);
  readonly logoUrl = signal<string | null>(null);

  /** ログイン中なら、ボタンを「トークを開く」にする(/about を会員が開いたとき)。 */
  readonly loggedIn = toSignal(this.auth.session$, { initialValue: undefined });

  constructor() {
    this.publicBranding
      .getTenant(environment.tenantId)
      .then((tenant) => {
        const name = tenant?.branding.siteTitle || FALLBACK_SERVICE_NAME;
        this.serviceName.set(name);
        this.organization.set(tenant?.name || FALLBACK_ORGANIZATION);
        this.logoUrl.set(tenant?.branding.logoUrl ?? null);
        this.titleService.setTitle(name);
        this.favicon.rememberTitle(name);
        this.favicon.apply(tenant?.branding.faviconUrl || tenant?.branding.logoUrl);
      })
      .catch(() => undefined);
  }

  scrollTo(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
