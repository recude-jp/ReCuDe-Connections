import { Injectable, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import { AuthService, MemberSession } from './auth.service';
import { CommunityRow, MemberService } from './member.service';
import type { CommunityScope, MembershipTerms, ProfileField } from '../models/firestore.models';

/** ルートコミュニティを表す、管理画面のURLの対象(/admin/root/...)。 */
export const ROOT_SCOPE_KEY = 'root';

/** 管理画面で選べる対象のコミュニティ。key は URL(/admin/:scope/...)に使う(root か連携コミュニティのID)。 */
export interface AdminScopeOption {
  key: string;
  scope: CommunityScope;
  name: string;
  logoUrl: string | null;
  /** ロゴが無いときの文字(連携コミュニティの logoText)。 */
  logoText: string | null;
  isCommunity: boolean;
}

/** 管理画面のタブ。scopes: そのタブを出す対象(連携コミュニティの一覧はルートコミュニティだけ)。 */
export interface AdminTab {
  path: string;
  label: string;
  rootOnly?: boolean;
}

/** 管理画面のタブ(並び順どおり)。各画面は AdminScopeService.current() の対象について表示・操作する。 */
export const ADMIN_TABS: AdminTab[] = [
  { path: 'members', label: '会員一覧' },
  { path: 'applications', label: '会員申請' },
  { path: 'profile-fields', label: 'プロフィール項目' },
  { path: 'membership-terms', label: '会員条件' },
  { path: 'communities', label: '連携コミュニティ', rootOnly: true },
  { path: 'stamps', label: 'スタンプ' },
  { path: 'settings', label: 'サービス設定' },
];

/** 管理画面に入れる対象(ルートの管理者はルートと全部の連携コミュニティ、連携コミュニティの管理者はその連携コミュニティ)。 */
export function adminScopeKeys(session: MemberSession, communityIds: string[]): string[] {
  if (session.isAdmin) {
    return [ROOT_SCOPE_KEY, ...communityIds];
  }
  return session.adminCommunityIds.filter((id) => communityIds.length === 0 || communityIds.includes(id));
}

/** その対象の管理画面に入れるか(ガード用。連携コミュニティの一覧を読まずに、カスタムクレームだけで判定する)。 */
export function canAdminScope(session: MemberSession | null | undefined, key: string): boolean {
  if (session?.kind !== 'member') {
    return false;
  }
  return key === ROOT_SCOPE_KEY ? session.isAdmin : session.isAdmin || session.adminCommunityIds.includes(key);
}

/**
 * 管理画面の対象のコミュニティ(SPEC 8章・9章)。ルートコミュニティと連携コミュニティを同じ画面で扱うため、
 * 各画面はここから対象・対象の設定(プロフィール項目・会員条件)・画面のリンクを受け取る。
 * 管理画面のルート(admin.routes.ts)で提供し、対象の切り替えは管理画面の枠(AdminLayout)が URL から行う。
 */
@Injectable()
export class AdminScopeService {
  private readonly auth = inject(AuthService);
  private readonly memberService = inject(MemberService);

  private readonly session = toSignal(this.auth.session$, { initialValue: undefined });
  readonly memberSession = computed(() => {
    const session = this.session();
    return session?.kind === 'member' ? session : null;
  });
  readonly tenantId = computed(() => this.memberSession()?.tenantId ?? '');

  readonly tenant = toSignal(
    this.auth.session$.pipe(
      switchMap((session) => (session?.kind === 'member' ? this.memberService.getTenant(session.tenantId) : of(undefined))),
    ),
  );
  /** テナントの全部の連携コミュニティ(undefined = 読み込み中)。 */
  readonly communities = toSignal(
    this.auth.session$.pipe(
      switchMap((session) =>
        session?.kind === 'member' ? this.memberService.listCommunities(session.tenantId) : of([] as CommunityRow[]),
      ),
    ),
  );

  /** 自分が管理できる対象(ルートが先、連携コミュニティは名前順)。 */
  readonly options = computed<AdminScopeOption[]>(() => {
    const session = this.memberSession();
    const communities = this.communities() ?? [];
    if (!session) {
      return [];
    }
    const keys = adminScopeKeys(session, communities.map((c) => c.id));
    const options: AdminScopeOption[] = [];
    if (keys.includes(ROOT_SCOPE_KEY)) {
      options.push({
        key: ROOT_SCOPE_KEY,
        scope: { type: 'root' },
        name: this.tenant()?.name ?? 'ルートコミュニティ',
        logoUrl: this.tenant()?.branding?.logoUrl ?? null,
        logoText: null,
        isCommunity: false,
      });
    }
    for (const community of [...communities].sort((a, b) => a.name.localeCompare(b.name, 'ja'))) {
      if (keys.includes(community.id)) {
        options.push({
          key: community.id,
          scope: { type: 'community', communityId: community.id },
          name: community.name,
          logoUrl: community.logoUrl ?? null,
          logoText: community.logoText ?? null,
          isCommunity: true,
        });
      }
    }
    return options;
  });

  /** URL の対象(AdminLayout が設定する)。 */
  readonly key = signal<string>(ROOT_SCOPE_KEY);

  readonly scope = computed<CommunityScope>(() =>
    this.key() === ROOT_SCOPE_KEY ? { type: 'root' } : { type: 'community', communityId: this.key() },
  );
  readonly isCommunity = computed(() => this.key() !== ROOT_SCOPE_KEY);
  /** 対象の連携コミュニティ(ルートのときは null。読み込み中・見つからないときは undefined)。 */
  readonly community = computed<CommunityRow | null | undefined>(() => {
    if (!this.isCommunity()) {
      return null;
    }
    return this.communities()?.find((c) => c.id === this.key());
  });
  readonly current = computed(() => this.options().find((o) => o.key === this.key()) ?? null);
  /** 対象の名前(ルートはテナント名)。 */
  readonly name = computed(() => (this.isCommunity() ? (this.community()?.name ?? '') : (this.tenant()?.name ?? '')));

  /** 対象のプロフィール項目(ルートはテナントの項目、連携コミュニティはその独自の項目)。undefined = 読み込み中。 */
  readonly profileFields = computed<ProfileField[] | undefined>(() => {
    if (this.isCommunity()) {
      const community = this.community();
      return community === undefined ? undefined : (community?.profileFields ?? []);
    }
    const tenant = this.tenant();
    return tenant === undefined ? undefined : (tenant.profileFields ?? []);
  });

  /** 対象の会員条件(連携コミュニティは参加の条件)。undefined = 読み込み中、null = 未設定。 */
  readonly membershipTerms = computed<MembershipTerms | null | undefined>(() => {
    if (this.isCommunity()) {
      const community = this.community();
      return community === undefined ? undefined : (community?.membershipTerms ?? null);
    }
    const tenant = this.tenant();
    return tenant === undefined ? undefined : (tenant.membershipTerms ?? null);
  });

  /** 対象の画面へのリンク(例: link('members', id) → /admin/:scope/members/:id)。 */
  link(...path: string[]): string[] {
    return ['/admin', this.key(), ...path];
  }
}
