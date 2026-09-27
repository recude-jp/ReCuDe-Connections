import { Component, computed, effect, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { toSignal } from '@angular/core/rxjs-interop';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import {
  IconDefinition,
  faCalendarDays,
  faCircleUser,
  faComments,
  faHandshake,
  faScrewdriverWrench,
  faUserPlus,
} from '@fortawesome/free-solid-svg-icons';
import { map, switchMap, of } from 'rxjs';
import { AuthService, canUseAdmin } from '../../core/services/auth.service';
import { CommunityRow, MemberService } from '../../core/services/member.service';
import { CommunityLogo } from '../community-logo/community-logo';
import { CountBadge } from '../count-badge/count-badge';
import { NotificationBadgeService } from '../../core/services/notification-badge.service';
import { FaviconService } from '../../core/services/favicon.service';
import type { Tenant } from '../../core/models/firestore.models';
import { DEFAULT_SITE_TITLE } from '../../core/utils/branding';

interface MainNavItem {
  path: string;
  label: string;
  icon: IconDefinition;
}

/** 会員向けのメイン4機能(SPEC「メイン機能と画面構成」)。 */
const MAIN_NAV: MainNavItem[] = [
  { path: '/talk', label: 'トーク', icon: faComments },
  { path: '/connect', label: 'つながる', icon: faHandshake },
  { path: '/events', label: 'イベント', icon: faCalendarDays },
  { path: '/mypage', label: 'マイページ', icon: faCircleUser },
];

/** ゲストには、マイページの代わりに「会員登録」を出す(正規の会員の申請へ)。 */
const GUEST_MYPAGE_NAV: MainNavItem = { path: '/mypage/membership', label: '会員登録', icon: faUserPlus };

/** 管理者(ルートコミュニティ・連携コミュニティ)にだけ表示する5つ目のメニュー。 */
const ADMIN_NAV: MainNavItem = { path: '/admin', label: '管理', icon: faScrewdriverWrench };


/**
 * 会員向け画面の共通レイアウト。PCは上部ヘッダ(ブランド名・ロゴ＋メニュー)、
 * スマホは下部タブバーにメイン4機能を並べる(切り替えはCSSのメディアクエリで行う)。
 * 管理者には5つ目の「管理」を加える。サービス名・アイコンはタブのタイトル・ファビコンにも反映する。
 * 連携コミュニティのメンバーには、ルートコミュニティのロゴの横に連携コミュニティのロゴを出す(SPEC 9章。2つまで、残りは +N)。
 */
@Component({
  selector: 'app-member-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FaIconComponent, CommunityLogo, CountBadge],
  templateUrl: './member-layout.html',
  styleUrl: './member-layout.scss',
})
export class MemberLayout {
  private readonly auth = inject(AuthService);
  private readonly memberService = inject(MemberService);
  private readonly titleService = inject(Title);
  private readonly favicon = inject(FaviconService);
  private readonly badges = inject(NotificationBadgeService);

  /** メニューのバッジ(トーク: 未読のメッセージ、管理: 審査待ちの申請)。 */
  private readonly unreadTotal = toSignal(this.badges.unreadTotal$, { initialValue: 0 });
  private readonly pendingApplications = toSignal(this.badges.pendingApplications$, { initialValue: 0 });

  badgeFor(path: string): { count: number; label: string } {
    if (path === '/talk') {
      return { count: this.unreadTotal(), label: '未読のメッセージ' };
    }
    if (path === '/admin') {
      return { count: this.pendingApplications(), label: '審査待ちの申請' };
    }
    return { count: 0, label: '' };
  }

  private readonly session = toSignal(this.auth.session$, { initialValue: undefined });

  readonly navItems = computed(() => {
    const session = this.session();
    if (session?.kind !== 'member') {
      return MAIN_NAV;
    }
    if (session.isGuest) {
      return MAIN_NAV.map((item) => (item.path === '/mypage' ? GUEST_MYPAGE_NAV : item));
    }
    return canUseAdmin(session) ? [...MAIN_NAV, ADMIN_NAV] : MAIN_NAV;
  });

  readonly tenant = toSignal(
    this.auth.session$.pipe(
      switchMap((session) =>
        session?.kind === 'member' ? this.memberService.getTenant(session.tenantId) : of(undefined),
      ),
    ),
    { initialValue: undefined as Tenant | undefined },
  );

  /** 所属する連携コミュニティ(ヘッダにロゴを出す)。 */
  private readonly myCommunities = toSignal(
    this.auth.session$.pipe(
      switchMap((session) =>
        session?.kind === 'member' && session.communityIds.length > 0
          ? this.memberService.listCommunities(session.tenantId).pipe(
              map((communities) => communities.filter((c) => session.communityIds.includes(c.id))),
            )
          : of([] as CommunityRow[]),
      ),
    ),
    { initialValue: [] as CommunityRow[] },
  );
  readonly shownCommunities = computed(() => this.myCommunities().slice(0, 2));
  readonly moreCommunities = computed(() => Math.max(0, this.myCommunities().length - 2));
  /** 「+N」に隠れている連携コミュニティの名前(ツールチップに出す)。 */
  readonly hiddenCommunityNames = computed(() =>
    this.myCommunities()
      .slice(2)
      .map((c) => c.name)
      .join('、'),
  );

  readonly brandName = computed(() => this.tenant()?.branding?.siteTitle || DEFAULT_SITE_TITLE);

  constructor() {
    effect(() => {
      this.titleService.setTitle(this.brandName());
      // テナントの設定を読み込む前の既定の名前は覚えない(次回の起動前の表示を、正しいサービス名にするため)。
      if (this.tenant()) {
        this.favicon.rememberTitle(this.brandName());
      }
    });

    effect(() => {
      const tenant = this.tenant();
      // テナントの設定を読み込むまでは変えない(起動前に index.html が出した前回のアイコンを、既定に戻さないため)。
      if (tenant) {
        this.favicon.apply(tenant.branding?.faviconUrl || tenant.branding?.logoUrl);
      }
    });
  }
}
