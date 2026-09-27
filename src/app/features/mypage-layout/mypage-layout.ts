import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';

interface MyPageTab {
  label: string;
  link: string;
  /** このタブを選択中と見なすパス(先頭一致しない別のパスもまとめるため)。 */
  paths: string[];
}

/** マイページの設定のカテゴリ。順番どおりにタブを並べる。 */
/** ゲストのマイページ。先頭に「会員登録」を置く。 */
const GUEST_TABS: MyPageTab[] = [
  { label: '会員登録', link: '/mypage/membership', paths: ['/mypage/membership'] },
  { label: 'プロフィール', link: '/mypage', paths: ['/mypage'] },
  { label: 'マイスタンプ', link: '/mypage/stamps', paths: ['/mypage/stamps'] },
  { label: 'ログイン設定', link: '/mypage/passkeys', paths: ['/mypage/passkeys'] },
];

const TABS: MyPageTab[] = [
  { label: 'プロフィール', link: '/mypage', paths: ['/mypage'] },
  { label: 'マイスタンプ', link: '/mypage/stamps', paths: ['/mypage/stamps'] },
  { label: 'ログイン設定', link: '/mypage/passkeys', paths: ['/mypage/passkeys'] },
];

/**
 * マイページ(/mypage)の共通枠。設定のカテゴリごとにタブで切り替える。
 * ログアウトはどのタブからでもできるよう、見出しの横に置く。
 */
@Component({
  selector: 'app-mypage-layout',
  imports: [RouterOutlet, RouterLink],
  templateUrl: './mypage-layout.html',
  styleUrl: './mypage-layout.scss',
})
export class MyPageLayout {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  private readonly session = toSignal(this.auth.session$, { initialValue: undefined });

  readonly isGuest = computed(() => {
    const session = this.session();
    return session?.kind === 'member' && session.isGuest;
  });

  /** 連携コミュニティだけのメンバーは、ゲストではなくそう表示する。 */
  readonly guestLabel = computed(() => {
    const session = this.session();
    return session?.kind === 'member' && session.membership === 'community' ? '連携コミュニティ' : 'ゲスト';
  });

  readonly tabs = computed(() => (this.isGuest() ? GUEST_TABS : TABS));

  private readonly path = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      startWith(null),
      map(() => this.router.url.split(/[?#]/)[0]),
    ),
    { initialValue: '' },
  );

  isActive(tab: MyPageTab): boolean {
    return tab.paths.includes(this.path());
  }

  readonly signingOut = signal(false);

  async signOut(): Promise<void> {
    this.signingOut.set(true);
    try {
      await this.auth.signOut();
      await this.router.navigate(['/login']);
    } finally {
      this.signingOut.set(false);
    }
  }
}
