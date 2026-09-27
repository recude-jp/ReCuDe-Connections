import { Component, computed, effect, inject, output } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, of, switchMap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { MemberService } from '../../core/services/member.service';
import { CommunityLogo } from '../community-logo/community-logo';
import type { InviteTarget } from '../../core/models/firestore.models';

/** 招待先の候補。key は URL の ?to= に使う(root か連携コミュニティのID)。 */
export interface InviteTargetOption {
  key: string;
  target: InviteTarget;
  name: string;
  logoUrl: string | null;
  logoText: string | null;
  isCommunity: boolean;
}

/**
 * 招待先の選択(SPEC 9章「連携 C1 の仕様」の4.)。ルートコミュニティの会員は、ルートコミュニティと自分が所属する
 * 連携コミュニティから、連携コミュニティだけのメンバーは所属する連携コミュニティから選ぶ。
 * 選んだ招待先は URL(?to=)に持たせ、QRコード(/connect)と招待の送付(/connect/send)で引き継ぐ。
 */
@Component({
  selector: 'app-invite-target-picker',
  imports: [CommunityLogo],
  templateUrl: './invite-target-picker.html',
  styleUrl: './invite-target-picker.scss',
})
export class InviteTargetPicker {
  private readonly auth = inject(AuthService);
  private readonly memberService = inject(MemberService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /** 選んでいる招待先が変わったとき(最初の表示を含む)。 */
  readonly targetChange = output<InviteTargetOption>();

  private readonly session = toSignal(this.auth.session$, { initialValue: undefined });
  private readonly tenant = toSignal(
    this.auth.session$.pipe(
      switchMap((session) => (session?.kind === 'member' ? this.memberService.getTenant(session.tenantId) : of(undefined))),
    ),
  );
  private readonly communities = toSignal(
    this.auth.session$.pipe(
      switchMap((session) =>
        session?.kind === 'member' && session.communityIds.length > 0
          ? this.memberService.listCommunities(session.tenantId)
          : of([]),
      ),
    ),
  );
  private readonly requestedKey = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('to'))));

  readonly options = computed<InviteTargetOption[] | undefined>(() => {
    const session = this.session();
    const tenant = this.tenant();
    const communities = this.communities();
    if (session?.kind !== 'member' || !tenant || communities === undefined) {
      return undefined;
    }
    const options: InviteTargetOption[] = [];
    if (!session.isGuest) {
      options.push({
        key: 'root',
        target: { type: 'root' },
        name: tenant.name,
        logoUrl: tenant.branding?.logoUrl ?? null,
        logoText: null,
        isCommunity: false,
      });
    }
    for (const community of communities) {
      if (session.communityIds.includes(community.id)) {
        options.push({
          key: community.id,
          target: { type: 'community', communityId: community.id },
          name: community.name,
          logoUrl: community.logoUrl ?? null,
          logoText: community.logoText ?? null,
          isCommunity: true,
        });
      }
    }
    return options;
  });

  readonly selected = computed(() => {
    const options = this.options();
    return options?.find((option) => option.key === this.requestedKey()) ?? options?.[0] ?? null;
  });

  constructor() {
    let emitted = '';
    effect(() => {
      const selected = this.selected();
      // 名称・ロゴの更新では出し直さない(招待先が変わったときだけ)。
      if (selected && selected.key !== emitted) {
        emitted = selected.key;
        this.targetChange.emit(selected);
      }
    });
  }

  choose(key: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { to: key === 'root' ? null : key },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
