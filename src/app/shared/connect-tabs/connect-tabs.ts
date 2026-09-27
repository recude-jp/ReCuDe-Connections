import { Component, computed, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { AuthService, canInvite } from '../../core/services/auth.service';

/**
 * メイン機能「つながる」の見出しとタブ。先頭が招待(/connect。QRコードと招待の送付 /connect/send)、
 * 次が出会いを探す(/connect/search)。ゲストは招待できないため、出会いを探すだけを出す
 * (連携コミュニティのメンバーは、その連携コミュニティへ招待できるため、ゲストと同じ区分でも招待を出す)。
 */
@Component({
  selector: 'app-connect-tabs',
  imports: [RouterLink],
  templateUrl: './connect-tabs.html',
  styleUrl: './connect-tabs.scss',
})
export class ConnectTabs {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly session = toSignal(this.auth.session$, { initialValue: undefined });

  /** 招待できるか(正規の会員か、連携コミュニティのメンバー)。 */
  readonly canInvite = computed(() => canInvite(this.session()));

  private readonly path = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      startWith(null),
      map(() => this.router.url.split(/[?#]/)[0]),
    ),
    { initialValue: '' },
  );

  readonly isSearch = computed(() => this.path() === '/connect/search');
  /** QRコードと招待の送付のどちらを開いていても、招待のタブを選択中にする。 */
  readonly isInvite = computed(() => ['/connect', '/connect/send'].includes(this.path()));
}
