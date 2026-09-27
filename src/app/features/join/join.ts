import { AfterViewInit, Component, inject, signal } from '@angular/core';
import { filter, firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { AuthService } from '../../core/services/auth.service';
import { InvitePreview, InviteService } from '../../core/services/invite.service';
import { PublicBrandingService } from '../../core/services/public-branding.service';
import { FaviconService } from '../../core/services/favicon.service';
import { PinInput } from '../../shared/pin-input/pin-input';
import { CommunityLogo } from '../../shared/community-logo/community-logo';
import { MembershipTermsView } from '../../shared/membership-terms/membership-terms';
import { toE164 } from '../../core/utils/phone';
import { toErrorMessage, toPhoneAuthErrorMessage } from '../../core/utils/errors';
import { DEFAULT_SITE_TITLE } from '../../core/utils/branding';
import { environment } from '../../../environments/environment';

/**
 * confirm: すでにアカウントがある人(ログイン中、または認証コードの確認後)が、参加を確かめる。
 * submitted: 参加に承認が必要な連携コミュニティへ申請した(審査待ち)。
 */
type Step = 'phone' | 'otp' | 'name' | 'confirm' | 'submitted';

/**
 * 招待リンク・QRコードから開く参加の画面(/join?code=...)。電話番号でログインしてゲストとして参加する。
 * ゲストになると、招待した人との1対1のトークができる。正規の会員の申請は、参加したあとのマイページの「会員登録」から。
 * code が無いとき(ゲストの仕組みを入れる前のSMS招待)は、ログインした電話番号あての招待を探す。
 * 連携コミュニティへの招待(SPEC 9章)では、招待先の名称・ロゴを出し、参加するとその連携コミュニティのメンバーになる。
 * すでにアカウントがある人は、名前を入れずに参加でき、その連携コミュニティが所属に加わる。
 */
@Component({
  selector: 'app-join',
  imports: [FormsModule, RouterLink, PinInput, CommunityLogo, MembershipTermsView],
  templateUrl: './join.html',
  styleUrl: './join.scss',
})
export class Join implements AfterViewInit {
  private readonly auth = inject(AuthService);
  private readonly inviteService = inject(InviteService);
  private readonly publicBranding = inject(PublicBrandingService);
  private readonly favicon = inject(FaviconService);
  private readonly titleService = inject(Title);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /** 招待リンクのコード(QRコード・招待の送付)。 */
  readonly code = this.route.snapshot.queryParamMap.get('code');

  readonly step = signal<Step>('phone');
  readonly phoneNumber = signal('');
  readonly otpCode = signal('');
  readonly displayName = signal('');
  /** 連携コミュニティの参加の条件に同意したか。 */
  readonly agreed = signal(false);
  readonly loading = signal(false);
  readonly errorMessage = signal('');

  /** 招待の案内(組織名・招待した人)。 */
  readonly preview = signal<InvitePreview | null>(null);

  constructor() {
    // 招待のSMS・QRコードから最初に開く画面のため、タブのタイトルとアイコンをテナントのものにする。
    this.publicBranding
      .getTenant(environment.tenantId)
      .then((tenant) => {
        this.titleService.setTitle(tenant?.branding.siteTitle || DEFAULT_SITE_TITLE);
        this.favicon.rememberTitle(tenant?.branding.siteTitle || DEFAULT_SITE_TITLE);
        this.favicon.apply(tenant?.branding.faviconUrl || tenant?.branding.logoUrl);
      })
      .catch(() => undefined);

    // 招待リンクのコードがあれば、ログインの前に誰からの招待かを出す。
    // すでにログインしている人(アカウントがある人)は、電話番号の入力を省いて参加の確認へ進む。
    if (this.code) {
      void this.loadPreviewForSession();
    }
  }

  private async loadPreviewForSession(): Promise<void> {
    try {
      const session = await firstValueFrom(this.auth.session$.pipe(filter((s) => s !== undefined)));
      const preview = await this.inviteService.getInvitePreview(this.code);
      this.applyPreview(preview);
      if (session && preview.alreadyJoined) {
        this.step.set('confirm');
      }
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    }
  }

  ngAfterViewInit(): void {
    this.auth.initRecaptcha('recaptcha-container');
  }

  async sendOtp(): Promise<void> {
    this.errorMessage.set('');
    this.loading.set(true);
    try {
      await this.auth.sendOtp(toE164(this.phoneNumber()));
      this.step.set('otp');
    } catch (err) {
      this.errorMessage.set(toPhoneAuthErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  async confirmOtp(): Promise<void> {
    this.errorMessage.set('');
    this.loading.set(true);
    try {
      await this.auth.confirmOtp(this.otpCode());
      // ログインした電話番号で、もう一度案内を取り直す(コードが無いときの招待探しと、参加済みかの確認)。
      const preview = await this.inviteService.getInvitePreview(this.code);
      this.applyPreview(preview);
      this.step.set(preview.alreadyJoined ? 'confirm' : 'name');
    } catch (err) {
      this.errorMessage.set(toPhoneAuthErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** 参加の条件への同意が必要で、まだ同意していないか(すでに参加している・審査待ちのときは要らない)。 */
  needsAgreement(): boolean {
    const preview = this.preview();
    return (
      !!preview?.community?.terms?.requireAgreement &&
      !preview.alreadyInTarget &&
      !preview.pendingApproval &&
      !this.agreed()
    );
  }

  async join(): Promise<void> {
    const name = this.displayName().trim();
    // すでにアカウントがある人は、名前を入れない(登録済みの名前のまま)。
    if ((!name && this.step() !== 'confirm') || this.needsAgreement()) {
      return;
    }
    this.errorMessage.set('');
    this.loading.set(true);
    try {
      const result = await this.inviteService.joinAsGuest(this.code, name, this.agreed());
      // ゲスト(または既に参加している人)としてのログイン状態にして、トークへ。
      await this.auth.resolveMemberSession();
      if (result.pendingApproval) {
        this.step.set('submitted');
        return;
      }
      await this.router.navigate(['/talk']);
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  async openTalk(): Promise<void> {
    await this.router.navigate(['/talk']);
  }

  private applyPreview(preview: InvitePreview): void {
    this.preview.set(preview);
    if (preview.name && !this.displayName()) {
      this.displayName.set(preview.name);
    }
  }
}
