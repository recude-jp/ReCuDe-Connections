import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, switchMap, of } from 'rxjs';
import { AuthService, MemberSession } from '../../core/services/auth.service';
import { CommunityRow, MemberService } from '../../core/services/member.service';
import { MemberSearchService } from '../../core/services/member-search.service';
import { SetupPromptBanner } from '../../shared/setup-prompt-banner/setup-prompt-banner';
import { ProfileForm } from '../../shared/profile-form/profile-form';
import { MemberAvatar } from '../../shared/member-avatar/member-avatar';
import { MyPageCommunities } from '../mypage-communities/mypage-communities';
import type { Member, ProfileValues, Tenant } from '../../core/models/firestore.models';
import { formatProfileValue, missingRequiredFields, visibleProfileFields } from '../../core/utils/profile-fields';
import { prepareAvatarImage } from '../../core/utils/image';
import { toErrorMessage } from '../../core/utils/errors';
import { clampIconText } from '../../core/utils/icon-text';

/**
 * マイページの「プロフィール」タブ(/mypage)。自分のプロフィールとロールを表示し、編集する。
 * 名前・プロフィール画像は全テナント共通の固定項目。それ以外の項目はテナントの管理者が管理画面で設定する。
 */
@Component({
  selector: 'app-mypage',
  imports: [FormsModule, RouterLink, SetupPromptBanner, ProfileForm, MemberAvatar, MyPageCommunities],
  templateUrl: './mypage.html',
  styleUrl: './mypage.scss',
})
export class MyPage {
  private readonly auth = inject(AuthService);
  private readonly memberService = inject(MemberService);
  private readonly searchService = inject(MemberSearchService);

  readonly session = toSignal(this.auth.session$, { initialValue: undefined });

  readonly memberSession = computed(() => {
    const session = this.session();
    return session?.kind === 'member' ? (session as MemberSession) : null;
  });

  readonly tenant = toSignal(
    this.auth.session$.pipe(
      switchMap((session) =>
        session?.kind === 'member' ? this.memberService.getTenant(session.tenantId) : of(undefined),
      ),
    ),
    { initialValue: undefined as Tenant | undefined },
  );

  /** 所属する連携コミュニティ(SPEC 9章)。 */
  readonly myCommunities = toSignal(
    this.auth.session$.pipe(
      switchMap((session) =>
        session?.kind === 'member' && session.communityIds.length > 0
          ? this.memberService
              .listCommunities(session.tenantId)
              .pipe(map((list) => list.filter((c) => session.communityIds.includes(c.id))))
          : of([] as CommunityRow[]),
      ),
    ),
    { initialValue: [] as CommunityRow[] },
  );

  // Firebase AuthのdisplayName(電話番号ログインでは未設定)ではなく、Firestoreの会員プロフィールを表示に使う。
  readonly member = toSignal(
    this.auth.session$.pipe(
      switchMap((session) =>
        session?.kind === 'member'
          ? this.memberService.getMember(session.tenantId, session.memberId)
          : of(undefined),
      ),
    ),
    { initialValue: undefined as Member | undefined },
  );

  /** 非公開のプロフィールの値(生年月など。本人だけが読める)。 */
  readonly privateValues = toSignal(
    this.auth.session$.pipe(
      switchMap((session) =>
        session?.kind === 'member' ? this.memberService.getPrivateProfile(session.tenantId, session.memberId) : of({}),
      ),
    ),
    { initialValue: {} as ProfileValues },
  );

  /** 表示する値(公開の値と、自分だけに見える非公開の値)。 */
  readonly allValues = computed<ProfileValues>(() => ({ ...(this.member()?.profile ?? {}), ...this.privateValues() }));

  readonly isGuest = computed(() => !!this.memberSession()?.isGuest);

  /** 表示・編集するプロフィール項目。ゲストは「会員登録」で入力するため、ここでは名前・画像だけにする。 */
  readonly fields = computed(() => (this.isGuest() ? [] : visibleProfileFields(this.tenant()?.profileFields)));
  readonly formatValue = formatProfileValue;

  // 編集
  readonly editing = signal(false);
  readonly draftName = signal('');
  /** 写真が無いときに丸いアイコンに出す文字(2文字まで。空なら名前の最初と最後の1文字)。 */
  readonly draftAvatarText = signal('');
  readonly draftProfile = signal<ProfileValues>({});
  readonly options = signal<Record<string, string[]>>({});
  /** 新しく選んだ画像(null = 画像を外す、undefined = 変えない)。 */
  readonly draftPhoto = signal<Blob | null | undefined>(undefined);
  readonly draftPhotoUrl = signal<string | null>(null);
  readonly saving = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  readonly missingFields = computed(() => missingRequiredFields(this.fields(), this.draftProfile()));

  constructor() {
    // 編集をやめたら、プレビュー用のURLを片付ける。
    effect(() => {
      if (!this.editing()) {
        this.clearPhotoPreview();
      }
    });
  }

  setAvatarText(value: string): void {
    this.draftAvatarText.set(clampIconText(value));
  }

  async startEdit(): Promise<void> {
    const member = this.member();
    const session = this.memberSession();
    if (!member || !session) {
      return;
    }
    this.errorMessage.set('');
    this.successMessage.set('');
    this.draftName.set(member.displayName);
    this.draftAvatarText.set(member.avatarText ?? '');
    this.draftProfile.set({ ...this.allValues() });
    this.draftPhoto.set(undefined);
    this.editing.set(true);

    // 自由入力・複数入力の入力候補(これまでに会員が入力した値)。
    const entries = await Promise.all(
      this.fields()
        .filter((field) => (field.type === 'text' || field.type === 'tags') && !field.private)
        .map(async (field) => [field.id, await this.searchService.getProfileOptions(session.tenantId, field.id)] as const),
    );
    this.options.set(Object.fromEntries(entries));
  }

  cancelEdit(): void {
    this.editing.set(false);
  }

  async onPhotoSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    this.errorMessage.set('');
    try {
      const blob = await prepareAvatarImage(file);
      this.clearPhotoPreview();
      this.draftPhoto.set(blob);
      this.draftPhotoUrl.set(URL.createObjectURL(blob));
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    }
  }

  removePhoto(): void {
    this.clearPhotoPreview();
    this.draftPhoto.set(null);
  }

  async save(): Promise<void> {
    const session = this.memberSession();
    if (!session || !this.draftName().trim() || this.missingFields().length > 0) {
      return;
    }
    this.errorMessage.set('');
    this.successMessage.set('');
    this.saving.set(true);
    try {
      const photo = this.draftPhoto();
      const photoPath =
        photo === undefined
          ? undefined
          : photo === null
            ? null
            : await this.memberService.uploadPhoto(session.tenantId, session.memberId, photo);
      await this.memberService.updateMyProfile(
        this.draftName().trim(),
        this.draftProfile(),
        photoPath,
        this.draftAvatarText(),
      );
      this.editing.set(false);
      this.successMessage.set('プロフィールを保存しました。');
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  private clearPhotoPreview(): void {
    const url = this.draftPhotoUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
    this.draftPhotoUrl.set(null);
  }
}
