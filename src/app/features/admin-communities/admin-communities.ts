import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { AdminService, MemberRow } from '../../core/services/admin.service';
import { CommunityRow, MemberService } from '../../core/services/member.service';
import { CommunityLogo } from '../../shared/community-logo/community-logo';
import { MemberPicker } from '../../shared/member-picker/member-picker';
import { isFullMember } from '../../core/utils/membership';
import { formatDate } from '../../core/utils/dates';
import { toErrorMessage } from '../../core/utils/errors';
import { clampIconText } from '../../core/utils/icon-text';

/** 管理者の欄に出す人(ルートコミュニティの会員でなくなった人には警告を出す)。 */
interface AdminView {
  id: string;
  name: string;
  warning: string;
}

const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/**
 * 管理画面の「連携コミュニティ」(/admin/communities。SPEC 9章「連携 C1 の仕様」)。
 * 一覧(ロゴ・名称・管理者・参加者数・作成日)と、追加・編集・削除。管理者はルートコミュニティの会員から1人以上選ぶ。
 */
@Component({
  selector: 'app-admin-communities',
  imports: [FormsModule, RouterLink, CommunityLogo, MemberPicker],
  templateUrl: './admin-communities.html',
  styleUrl: './admin-communities.scss',
})
export class AdminCommunities {
  private readonly auth = inject(AuthService);
  private readonly adminService = inject(AdminService);
  private readonly memberService = inject(MemberService);

  private readonly session = toSignal(this.auth.session$, { initialValue: undefined });

  readonly communities = toSignal(
    this.auth.session$.pipe(
      switchMap((session) => (session?.kind === 'member' ? this.memberService.listCommunities(session.tenantId) : of(undefined))),
    ),
    { initialValue: undefined as CommunityRow[] | undefined },
  );
  readonly members = toSignal(
    this.auth.session$.pipe(
      switchMap((session) => (session?.kind === 'member' ? this.adminService.listMembers(session.tenantId) : of([]))),
    ),
    { initialValue: [] as MemberRow[] },
  );

  readonly sortedCommunities = computed(() =>
    [...(this.communities() ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'ja')),
  );
  private readonly membersById = computed(() => new Map(this.members().map((m) => [m.id, m])));
  /** 管理者に選べる人(ルートコミュニティの有効な正規の会員)。 */
  readonly adminCandidates = computed(() => this.members().filter((m) => m.isActive && isFullMember(m)));

  /** 開いているフォーム。'new': 追加、ID: 編集、null: 閉じている。 */
  readonly editing = signal<string | null>(null);
  readonly name = signal('');
  readonly description = signal('');
  /** ロゴが無いときに出す文字(2文字まで)。 */
  readonly logoText = signal('');
  readonly adminIds = signal<string[]>([]);
  readonly logoFile = signal<File | null>(null);
  readonly logoPreview = signal<string | null>(null);
  readonly removeLogo = signal(false);

  /** 削除の確認を出している連携コミュニティと、入力された名称。 */
  readonly deleting = signal<string | null>(null);
  readonly confirmName = signal('');

  readonly processing = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  readonly canSave = computed(() => !!this.name().trim() && this.adminIds().length > 0 && !this.processing());
  readonly formatDate = formatDate;

  admins(community: CommunityRow): AdminView[] {
    return community.adminIds.map((id) => {
      const member = this.membersById().get(id);
      const warning = !member
        ? '見つかりません'
        : !member.isActive
          ? '停止中'
          : !isFullMember(member)
            ? 'ルートの会員ではありません'
            : '';
      return { id, name: member?.displayName ?? '（不明）', warning };
    });
  }

  hasAdminWarning(community: CommunityRow): boolean {
    return this.admins(community).some((admin) => admin.warning);
  }

  openNew(): void {
    this.resetMessages();
    this.fillForm('new', '', '', [], null, '');
  }

  openEdit(community: CommunityRow): void {
    this.resetMessages();
    // ルートの会員でなくなった管理者は、選び直してもらうため外しておく。
    const valid = community.adminIds.filter((id) => !this.admins(community).find((a) => a.id === id)?.warning);
    this.fillForm(community.id, community.name, community.description ?? '', valid, community.logoUrl ?? null, community.logoText ?? '');
  }

  closeForm(): void {
    this.editing.set(null);
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
    const session = this.session();
    const editing = this.editing();
    if (!this.canSave() || session?.kind !== 'member' || !editing) {
      return;
    }
    this.resetMessages();
    this.processing.set(true);
    const input = {
      name: this.name().trim(),
      description: this.description().trim(),
      adminIds: this.adminIds(),
      logoText: this.logoText(),
    };
    try {
      const file = this.logoFile();
      if (editing === 'new') {
        const communityId = await this.adminService.createCommunity(input);
        if (file) {
          const logoUrl = await this.adminService.uploadCommunityLogo(session.tenantId, communityId, file);
          await this.adminService.updateCommunity(communityId, { ...input, logoUrl });
        }
        this.successMessage.set(`「${input.name}」を追加しました。`);
      } else {
        const logoUrl = file
          ? await this.adminService.uploadCommunityLogo(session.tenantId, editing, file)
          : this.removeLogo()
            ? null
            : undefined;
        await this.adminService.updateCommunity(editing, { ...input, logoUrl });
        this.successMessage.set(`「${input.name}」を保存しました。`);
      }
      this.editing.set(null);
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.processing.set(false);
    }
  }

  askDelete(community: CommunityRow): void {
    this.resetMessages();
    this.editing.set(null);
    this.deleting.set(community.id);
    this.confirmName.set('');
  }

  async confirmDelete(community: CommunityRow): Promise<void> {
    if (this.confirmName().trim() !== community.name) {
      return;
    }
    this.resetMessages();
    this.processing.set(true);
    try {
      await this.adminService.deleteCommunity(community.id, this.confirmName().trim());
      this.deleting.set(null);
      this.successMessage.set(`「${community.name}」を削除しました。`);
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.processing.set(false);
    }
  }

  setLogoText(value: string): void {
    this.logoText.set(clampIconText(value));
  }

  private fillForm(
    id: string,
    name: string,
    description: string,
    adminIds: string[],
    logoUrl: string | null,
    logoText: string,
  ): void {
    this.logoText.set(logoText);
    this.deleting.set(null);
    this.editing.set(id);
    this.name.set(name);
    this.description.set(description);
    this.adminIds.set(adminIds);
    this.logoFile.set(null);
    this.logoPreview.set(logoUrl);
    this.removeLogo.set(false);
  }

  private resetMessages(): void {
    this.errorMessage.set('');
    this.successMessage.set('');
  }
}
