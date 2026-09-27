import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { AdminService, MemberRow } from '../../core/services/admin.service';
import { AdminScopeService } from '../../core/services/admin-scope.service';
import { CommunityLogo } from '../../shared/community-logo/community-logo';
import { toErrorMessage } from '../../core/utils/errors';
import { clampIconText } from '../../core/utils/icon-text';

const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/**
 * 連携コミュニティの管理画面のサービス設定(/admin/:communityId/settings)。名称・ロゴ・説明を変える。
 * 管理者の任命・解除は会員詳細で行う(ここでは一覧だけ出す)。
 */
@Component({
  selector: 'app-admin-community-settings',
  imports: [FormsModule, RouterLink, CommunityLogo],
  templateUrl: './admin-community-settings.html',
  styleUrl: '../admin-communities/admin-communities.scss',
})
export class AdminCommunitySettings {
  private readonly auth = inject(AuthService);
  private readonly adminService = inject(AdminService);
  readonly scopes = inject(AdminScopeService);

  private readonly members = toSignal(
    this.auth.session$.pipe(
      switchMap((session) => (session?.kind === 'member' ? this.adminService.listMembers(session.tenantId) : of([]))),
    ),
    { initialValue: [] as MemberRow[] },
  );
  readonly admins = computed(() => {
    const ids = this.scopes.community()?.adminIds ?? [];
    return ids.map((id) => ({ id, name: this.members().find((m) => m.id === id)?.displayName ?? '（不明）' }));
  });

  readonly name = signal('');
  readonly description = signal('');
  /** ロゴが無いときに出す文字(2文字まで)。 */
  readonly logoText = signal('');
  readonly logoFile = signal<File | null>(null);
  readonly logoPreview = signal<string | null>(null);
  readonly removeLogo = signal(false);
  private initializedKey: string | null = null;

  readonly processing = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  constructor() {
    // 連携コミュニティの設定が届いた最初の1回だけ、フォームに反映する(対象を切り替えたら読み込み直す)。
    effect(() => {
      const community = this.scopes.community();
      if (community && this.initializedKey !== community.id) {
        this.initializedKey = community.id;
        this.name.set(community.name);
        this.description.set(community.description ?? '');
        this.logoText.set(community.logoText ?? '');
        this.logoFile.set(null);
        this.logoPreview.set(community.logoUrl ?? null);
        this.removeLogo.set(false);
        this.errorMessage.set('');
        this.successMessage.set('');
      }
    });
  }

  setLogoText(value: string): void {
    this.logoText.set(clampIconText(value));
  }

  onLogoSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    if (file && (!file.type.startsWith('image/') || file.size > LOGO_MAX_BYTES)) {
      this.errorMessage.set('ロゴは2MBまでの画像を選んでください。');
      return;
    }
    this.errorMessage.set('');
    this.logoFile.set(file);
    this.removeLogo.set(false);
    this.logoPreview.set(file ? URL.createObjectURL(file) : null);
  }

  clearLogo(): void {
    this.logoFile.set(null);
    this.logoPreview.set(null);
    this.removeLogo.set(true);
  }

  async save(): Promise<void> {
    const community = this.scopes.community();
    if (!community || !this.name().trim()) {
      return;
    }
    this.errorMessage.set('');
    this.successMessage.set('');
    this.processing.set(true);
    try {
      const file = this.logoFile();
      const logoUrl = file
        ? await this.adminService.uploadCommunityLogo(this.scopes.tenantId(), community.id, file)
        : this.removeLogo()
          ? null
          : undefined;
      await this.adminService.updateCommunity(community.id, {
        name: this.name().trim(),
        description: this.description().trim(),
        logoText: this.logoText(),
        logoUrl,
      });
      this.logoFile.set(null);
      this.successMessage.set('保存しました。');
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.processing.set(false);
    }
  }
}
