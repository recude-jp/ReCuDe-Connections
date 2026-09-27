import { Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { ADMIN_TABS, AdminScopeOption, AdminScopeService } from '../../core/services/admin-scope.service';
import { CommunityLogo } from '../../shared/community-logo/community-logo';

/**
 * 管理画面(/admin/:scope)の共通枠。対象のコミュニティの切り替えメニュー(複数のコミュニティを管理しているとき)と、
 * 対象に合わせたタブ(連携コミュニティでは「連携コミュニティ」のタブを出さない)を出す。
 */
@Component({
  selector: 'app-admin-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommunityLogo],
  templateUrl: './admin-layout.html',
  styleUrl: './admin-layout.scss',
  host: { '(document:keydown.escape)': 'menuOpen.set(false)' },
})
export class AdminLayout {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly scopes = inject(AdminScopeService);

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
