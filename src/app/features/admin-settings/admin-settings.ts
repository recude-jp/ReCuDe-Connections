import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { switchMap, of } from 'rxjs';
import { AuthService, MemberSession } from '../../core/services/auth.service';
import { MemberService } from '../../core/services/member.service';
import { TenantBrandingService } from '../../core/services/tenant-branding.service';
import type { Tenant } from '../../core/models/firestore.models';
import { toErrorMessage } from '../../core/utils/errors';
import { prepareFaviconImage } from '../../core/utils/image';
import { AdminScopeService } from '../../core/services/admin-scope.service';
import { AdminCommunitySettings } from '../admin-community-settings/admin-community-settings';

const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024;

/**
 * 管理画面のサービス設定(/admin/:scope/settings)。ルートコミュニティはサービス名とアイコン(ロゴ画像)、
 * 連携コミュニティは名称・ロゴ・説明(AdminCommunitySettings)を設定する。
 */
@Component({
  selector: 'app-admin-settings',
  imports: [FormsModule, AdminCommunitySettings],
  templateUrl: './admin-settings.html',
  styleUrl: './admin-settings.scss',
})
export class AdminSettings {
  private readonly auth = inject(AuthService);
  private readonly memberService = inject(MemberService);
  private readonly brandingService = inject(TenantBrandingService);
  readonly scopes = inject(AdminScopeService);

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

  readonly siteTitle = signal('');
  readonly siteTitleInitialized = signal(false);
  readonly selectedFile = signal<File | null>(null);
  readonly previewUrl = signal<string | null>(null);
  readonly saving = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  constructor() {
    // Firestoreからテナント情報が届いた最初の1回だけ、フォームの初期値として反映する。
    // (以降のFirestore再取得でユーザーの未保存の入力を上書きしないため)
    effect(() => {
      const tenant = this.tenant();
      if (tenant && !this.siteTitleInitialized()) {
        this.siteTitle.set(tenant.branding?.siteTitle ?? '');
        this.siteTitleInitialized.set(true);
      }
    });
  }

  readonly currentLogoUrl = computed(() => this.tenant()?.branding?.logoUrl ?? null);
  readonly displayLogoUrl = computed(() => this.previewUrl() ?? this.currentLogoUrl());
  /** タブでの見え方のプレビュー(新しい画像を選んだときはその画像、保存済みならファビコン)。 */
  readonly displayFaviconUrl = computed(
    () => this.previewUrl() ?? this.tenant()?.branding?.faviconUrl ?? this.currentLogoUrl(),
  );

  onFileSelected(event: Event): void {
    this.errorMessage.set('');
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      this.errorMessage.set('画像ファイルを選択してください。');
      return;
    }
    if (file.size > MAX_LOGO_SIZE_BYTES) {
      this.errorMessage.set('ファイルサイズは2MB以内にしてください。');
      return;
    }

    this.selectedFile.set(file);
    this.previewUrl.set(URL.createObjectURL(file));
  }

  async save(): Promise<void> {
    const session = this.memberSession();
    if (!session) {
      return;
    }

    this.errorMessage.set('');
    this.successMessage.set('');
    this.saving.set(true);
    try {
      let logoUrl = this.currentLogoUrl() ?? undefined;
      let faviconUrl: string | undefined;
      const file = this.selectedFile();
      if (file) {
        // ロゴから正方形のファビコンも作る(横長のロゴでもタブのアイコンが潰れないように)。
        const favicon = await prepareFaviconImage(file);
        [logoUrl, faviconUrl] = await Promise.all([
          this.brandingService.uploadLogo(session.tenantId, file),
          this.brandingService.uploadFavicon(session.tenantId, favicon),
        ]);
      }

      await this.brandingService.updateBranding(this.siteTitle(), logoUrl, faviconUrl);
      this.successMessage.set('保存しました。');
      this.selectedFile.set(null);
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
