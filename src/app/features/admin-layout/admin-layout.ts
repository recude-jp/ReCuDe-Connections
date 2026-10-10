import { Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { ADMIN_TABS, AdminScopeOption, AdminScopeService, ROOT_SCOPE_KEY } from '../../core/services/admin-scope.service';
import { CommunityLogo } from '../../shared/community-logo/community-logo';
import { CountBadge } from '../../shared/count-badge/count-badge';
import { NotificationBadgeService } from '../../core/services/notification-badge.service';

/**
 * 管理画面(/admin/:scope)の共通枠。対象のコミュニティの切り替えメニュー(複数のコミュニティを管理しているとき)と、
 * 対象に合わせたタブ(連携コミュニティでは「連携コミュニティ」のタブを出さない)を出す。
 * 審査待ちの申請があれば、「会員申請」「招待申請」のタブと、切り替えメニュー(対象ごとの件数)にバッジを出す。
 */
@Component({
  selector: 'app-admin-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommunityLogo, CountBadge],
  templateUrl: './admin-layout.html',
  styleUrl: './admin-layout.scss',
  host: { '(document:keydown.escape)': 'menuOpen.set(false)' },
})
export class AdminLayout {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly scopes = inject(AdminScopeService);
  private readonly badges = inject(NotificationBadgeService);

  private readonly pendingByScope = toSignal(this.badges.pendingByScope$, {
    initialValue: {} as Record<string, number>,
  });
  private readonly pendingInviteRequests = toSignal(this.badges.pendingInviteRequests$, { initialValue: 0 });

  private readonly scopeKey = toSignal(this.route.paramMap.pipe(map((params) => params.get('scope') ?? '')), {
    initialValue: '',
  });

  /** 開いているタブ(/admin/:scope/:tab)。対象を切り替えても同じタブを開く。 */
  private readonly tabPath = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      startWith(null),
      map(() => this.router.url.split(/[?#]/)[0].split('/')[3] ?? 'members'),
    ),
    { initialValue: 'members' },
  );

  readonly tabs = computed(() => ADMIN_TABS.filter((tab) => !tab.rootOnly || !this.scopes.isCommunity()));
  readonly menuOpen = signal(false);

  /** 対象(ルート・連携コミュニティ)の審査待ちの件数。ルートには確認待ちの招待申請も含める。 */
  pendingFor(scopeKey: string): number {
    const invites = scopeKey === ROOT_SCOPE_KEY ? this.pendingInviteRequests() : 0;
    return (this.pendingByScope()[scopeKey] ?? 0) + invites;
  }

  /** タブのバッジの件数(「会員申請」は開いている対象の申請、「招待申請」は確認待ちの招待申請)。 */
  tabBadge(path: string): number {
    const current = this.scopes.current();
    if (path === 'invite-requests') {
      return this.pendingInviteRequests();
    }
    return path === 'applications' && current ? (this.pendingByScope()[current.key] ?? 0) : 0;
  }

  /** 切り替えメニューのボタンのバッジ: 開いていないほかの対象の審査待ちの合計(気づけるように)。 */
  readonly otherScopesPending = computed(() => {
    const currentKey = this.scopes.current()?.key;
    return this.scopes
      .options()
      .filter((o) => o.key !== currentKey)
      .reduce((total, o) => total + this.pendingFor(o.key), 0);
  });

  constructor() {
    effect(() => this.scopes.key.set(this.scopeKey()));
  }

  choose(option: AdminScopeOption): void {
    this.menuOpen.set(false);
    const tab = ADMIN_TABS.find((t) => t.path === this.tabPath());
    const path = !tab || (tab.rootOnly && option.isCommunity) ? 'members' : tab.path;
    void this.router.navigate(['/admin', option.key, path]);
  }
}
