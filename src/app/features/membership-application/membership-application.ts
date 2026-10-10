import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom, of, switchMap } from 'rxjs';
import { AuthService, MemberSession } from '../../core/services/auth.service';
import { MemberService } from '../../core/services/member.service';
import { MemberSearchService } from '../../core/services/member-search.service';
import type { Member, ProfileValues, ProfileVisibility, Tenant } from '../../core/models/firestore.models';
import { ProfileForm } from '../../shared/profile-form/profile-form';
import { MembershipTermsView } from '../../shared/membership-terms/membership-terms';
import { missingRequiredFields, visibleProfileFields } from '../../core/utils/profile-fields';
import { formatDate } from '../../core/utils/dates';
import { toErrorMessage } from '../../core/utils/errors';
import { isFullMember } from '../../core/utils/membership';

/**
 * マイページの「会員登録」(/mypage/membership)。ゲストが正規の会員を申請する。
 * 会員条件(年会費など)を読み、テナントのプロフィール項目を入力して申請する。審査は管理者(事務局)が行う。
 * 正規の会員が開いたときは、会員であることだけを出す。
 */
@Component({
  selector: 'app-membership-application',
  imports: [ProfileForm, MembershipTermsView],
  templateUrl: './membership-application.html',
  styleUrl: './membership-application.scss',
})
export class MembershipApplicationPage {
  private readonly auth = inject(AuthService);
  private readonly memberService = inject(MemberService);
  private readonly searchService = inject(MemberSearchService);

  readonly formatDate = formatDate;

  readonly session = toSignal(this.auth.session$, { initialValue: undefined });
  readonly memberSession = computed(() => {
    const session = this.session();
    return session?.kind === 'member' ? (session as MemberSession) : null;
  });

  readonly tenant = toSignal(
    this.auth.session$.pipe(
      switchMap((session) => (session?.kind === 'member' ? this.memberService.getTenant(session.tenantId) : of(undefined))),
    ),
    { initialValue: undefined as Tenant | undefined },
  );

  readonly member = toSignal(
    this.auth.session$.pipe(
      switchMap((session) =>
        session?.kind === 'member' ? this.memberService.getMember(session.tenantId, session.memberId) : of(undefined),
      ),
    ),
    { initialValue: undefined as Member | undefined },
  );

  readonly fields = computed(() => visibleProfileFields(this.tenant()?.profileFields));
  readonly terms = computed(() => this.tenant()?.membershipTerms ?? null);
  readonly isFullMember = isFullMember;
  readonly application = computed(() => this.member()?.membershipApplication ?? null);

  /** 申請のフォームを出すか(まだ申請していない、または否認されて申請し直すとき)。 */
  readonly canApply = computed(() => {
    const member = this.member();
    return !!member && !isFullMember(member) && this.application()?.status !== 'pending';
  });

  readonly profile = signal<ProfileValues>({});
  /** 項目ごとの公開範囲(本人が選ぶ。未設定は非公開)。 */
  readonly visibility = signal<Record<string, ProfileVisibility>>({});
  readonly options = signal<Record<string, string[]>>({});
  readonly agreed = signal(false);
  readonly submitting = signal(false);
  readonly errorMessage = signal('');
  private formInitialized = false;

  readonly missingFields = computed(() => missingRequiredFields(this.fields(), this.profile()));
  readonly needsAgreement = computed(() => !!this.terms()?.requireAgreement && !this.agreed());

  constructor() {
    // 会員データとプロフィール項目が届いたら、入力済みの値(否認後の再申請など)をフォームの初期値にする(1回だけ)。
    effect(() => {
      const session = this.memberSession();
      const member = this.member();
      if (session && member && this.tenant() && !this.formInitialized) {
        void this.prepareForm(session.tenantId, member);
      }
    });
  }

  private async prepareForm(tenantId: string, member: Member): Promise<void> {
    this.formInitialized = true;
    // 非公開の値(生年月など)も、入力済みなら初期値にする(否認後の再申請など)。
    const stored = await firstValueFrom(this.memberService.getPrivateProfileDoc(tenantId, this.memberSession()!.memberId));
    this.profile.set({ ...(member.profile ?? {}), ...stored.values });
    this.visibility.set({ ...stored.visibility });
    const entries = await Promise.all(
      this.fields()
        .filter((field) => (field.type === 'text' || field.type === 'tags') && !field.private)
        .map(async (field) => [field.id, await this.searchService.getProfileOptions(tenantId, field.id)] as const),
    );
    this.options.set(Object.fromEntries(entries));
  }

  async submit(): Promise<void> {
    if (this.missingFields().length > 0 || this.needsAgreement()) {
      return;
    }
    this.errorMessage.set('');
    this.submitting.set(true);
    try {
      await this.memberService.applyForMembership(this.profile(), this.agreed(), this.visibility());
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.submitting.set(false);
    }
  }
}
