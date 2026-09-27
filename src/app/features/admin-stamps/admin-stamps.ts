import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { AdminService } from '../../core/services/admin.service';
import { AdminScopeService } from '../../core/services/admin-scope.service';
import { CommunityStampService } from '../../core/services/community-stamp.service';
import { AdminStampPack } from '../admin-stamp-pack/admin-stamp-pack';
import { toErrorMessage } from '../../core/utils/errors';

/**
 * 管理画面の「スタンプ」(/admin/:scope/stamps。管理 A2)。対象のコミュニティ専用のスタンプのパックを登録する。
 * ルートのパックはルートコミュニティの正規の会員が、連携コミュニティのパックはそのメンバーが、トークで使える。
 */
@Component({
  selector: 'app-admin-stamps',
  imports: [FormsModule, AdminStampPack],
  templateUrl: './admin-stamps.html',
  styleUrl: './admin-stamps.scss',
})
export class AdminStamps {
  private readonly auth = inject(AuthService);
  private readonly adminService = inject(AdminService);
  private readonly stampService = inject(CommunityStampService);
  readonly scopes = inject(AdminScopeService);

  readonly packs = toSignal(
    this.auth.session$.pipe(
      switchMap((session) => (session?.kind === 'member' ? this.stampService.packs(session.tenantId) : of(undefined))),
    ),
  );

  /** 対象のコミュニティのパック(作った順)。 */
  readonly scopePacks = computed(() => {
    const scope = this.scopes.scope();
    return (this.packs() ?? [])
      .filter((pack) =>
        scope.type === 'root' ? pack.scope.type === 'root' : pack.scope.communityId === scope.communityId,
      )
      .sort((a, b) => a.id.localeCompare(b.id));
  });

  readonly note = computed(() =>
    this.scopes.isCommunity()
      ? `「${this.scopes.name()}」のメンバーが使えます。`
      : 'ルートコミュニティの正規の会員が使えます（ゲスト・連携コミュニティだけのメンバーは使えません）。',
  );

  readonly newPackName = signal('');
  readonly processing = signal(false);
  readonly errorMessage = signal('');

  async createPack(): Promise<void> {
    const name = this.newPackName().trim();
    if (!name) {
      return;
    }
    this.errorMessage.set('');
    this.processing.set(true);
    try {
      await this.adminService.createStampPack(name, this.scopes.scope());
      this.newPackName.set('');
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.processing.set(false);
    }
  }
}
