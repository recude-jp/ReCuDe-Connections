import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { PublicBrandingService } from '../../core/services/public-branding.service';
import { FaviconService } from '../../core/services/favicon.service';
import { InviteRequestService } from '../../core/services/invite-request.service';
import { toE164 } from '../../core/utils/phone';
import { toErrorMessage } from '../../core/utils/errors';
import { environment } from '../../../environments/environment';

const FALLBACK_SERVICE_NAME = 'TOKYO GIFU CONNECT';

/** 「はい／いいえ」の答え(未回答は null)。 */
type YesNo = boolean | null;

/** 在京同窓会の選択で「一覧にない」を選んだときの値。 */
export const OTHER_ALUMNI = '__other__';

/**
 * 招待申請(/request)。会員に知り合いがいない人が、ログインせずに招待を申請する公開フォーム。
 * 利用の条件(東京岐阜県人会の会員か、連携している在京同窓会の会員)は、事務局が名簿などで確かめてから招待を送る。
 */
@Component({
  selector: 'app-invite-request',
  imports: [FormsModule, RouterLink],
  templateUrl: './invite-request.html',
  styleUrl: './invite-request.scss',
})
export class InviteRequestPage {
  private readonly publicBranding = inject(PublicBrandingService);
  private readonly favicon = inject(FaviconService);
  private readonly titleService = inject(Title);
  private readonly requests = inject(InviteRequestService);

  readonly OTHER_ALUMNI = OTHER_ALUMNI;

  readonly serviceName = signal(FALLBACK_SERVICE_NAME);
  readonly organization = signal('東京岐阜県人会');
  readonly logoUrl = signal<string | null>(null);
  readonly communities = signal<{ id: string; name: string }[]>([]);

  readonly name = signal('');
  readonly phoneNumber = signal('');
  readonly email = signal('');
  readonly hometown = signal('');
  readonly highSchool = signal('');
  readonly juniorHighSchool = signal('');
  readonly kenjinkaiMember = signal<YesNo>(null);
  readonly alumniMember = signal<YesNo>(null);
  readonly alumniChoice = signal('');
  readonly alumniOtherName = signal('');
  readonly referrer = signal('');
  readonly note = signal('');
  readonly agreed = signal(false);

  readonly submitting = signal(false);
  readonly submitted = signal(false);
  readonly errorMessage = signal('');

  /** どちらも「いいえ」のときは、利用の条件を満たさない。 */
  readonly notEligible = computed(() => this.kenjinkaiMember() === false && this.alumniMember() === false);

  readonly canSubmit = computed(
    () =>
      !this.submitting() &&
      !!this.name().trim() &&
      !!this.phoneNumber().trim() &&
      !!this.hometown().trim() &&
      !!(this.highSchool().trim() || this.juniorHighSchool().trim()) &&
      this.kenjinkaiMember() !== null &&
      this.alumniMember() !== null &&
      !this.notEligible() &&
      (this.alumniMember() !== true ||
        (!!this.alumniChoice() && (this.alumniChoice() !== OTHER_ALUMNI || !!this.alumniOtherName().trim()))) &&
      this.agreed(),
  );

  constructor() {
    this.publicBranding
      .getTenant(environment.tenantId)
      .then((tenant) => {
        const name = tenant?.branding.siteTitle || FALLBACK_SERVICE_NAME;
        this.serviceName.set(name);
        this.organization.set(tenant?.name || '東京岐阜県人会');
        this.logoUrl.set(tenant?.branding.logoUrl ?? null);
        this.titleService.setTitle(`招待の申請 | ${name}`);
        this.favicon.apply(tenant?.branding.faviconUrl || tenant?.branding.logoUrl);
      })
      .catch(() => undefined);
    this.requests
      .getCommunities(environment.tenantId)
      .then((list) => this.communities.set(list))
      .catch(() => undefined);
  }

  async submit(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }
    this.errorMessage.set('');
    this.submitting.set(true);
    try {
      const alumni = this.alumniMember() === true;
      await this.requests.submit({
        tenantId: environment.tenantId,
        name: this.name().trim(),
        phoneNumber: toE164(this.phoneNumber()),
        email: this.email().trim(),
        hometown: this.hometown().trim(),
        highSchool: this.highSchool().trim(),
        juniorHighSchool: this.juniorHighSchool().trim(),
        kenjinkaiMember: this.kenjinkaiMember() === true,
        alumniMember: alumni,
        alumniCommunityId: alumni && this.alumniChoice() !== OTHER_ALUMNI ? this.alumniChoice() : '',
        alumniOtherName: alumni && this.alumniChoice() === OTHER_ALUMNI ? this.alumniOtherName().trim() : '',
        referrer: this.referrer().trim(),
        note: this.note().trim(),
        agreed: this.agreed(),
      });
      this.submitted.set(true);
      window.scrollTo({ top: 0 });
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.submitting.set(false);
    }
  }
}
