import { Component, computed, inject, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { MyStampService } from '../../../core/services/my-stamp.service';
import {
  CommunityStampService,
  canUseStampPack,
  communityStampImageUrl,
  sortedStamps,
} from '../../../core/services/community-stamp.service';
import { CUSTOM_STAMP_PACK_ID, type StampRef } from '../../../core/models/firestore.models';
import { VISIBLE_STAMP_PACKS, stampImageUrl } from '../../../core/utils/stamps';
import { StampImage } from '../../../shared/stamp-image/stamp-image';

/** パネルのタブ1つ分(組み込みのパックとコミュニティのパックを同じ形にそろえる)。 */
interface PanelPack {
  packId: string;
  name: string;
  /** タブに出す画像(先頭のスタンプ)。 */
  iconUrl: string | null;
  stamps: { id: string; text: string; url: string }[];
}

/**
 * スタンプ選択パネル(SPEC 5-4)。コミュニティのスタンプ(ルートコミュニティ・所属する連携コミュニティ。管理 A2)、
 * 組み込みのパック、「マイスタンプ」をタブで切り替え、押したスタンプを picked で親に伝える(送信できたら親がパネルを閉じる)。
 */
@Component({
  selector: 'app-stamp-picker',
  imports: [RouterLink, StampImage],
  templateUrl: './stamp-picker.html',
  styleUrl: './stamp-picker.scss',
})
export class StampPicker {
  private readonly auth = inject(AuthService);
  private readonly myStampService = inject(MyStampService);
  private readonly communityStampService = inject(CommunityStampService);

  readonly picked = output<StampRef>();

  readonly customPackId = CUSTOM_STAMP_PACK_ID;

  private readonly session = toSignal(this.auth.session$, { initialValue: undefined });

  readonly myStamps = toSignal(
    this.auth.session$.pipe(
      switchMap((session) =>
        session?.kind === 'member' ? this.myStampService.listMine(session.tenantId, session.memberId) : of([]),
      ),
    ),
    { initialValue: [] },
  );

  private readonly communityPacks = toSignal(
    this.auth.session$.pipe(
      switchMap((session) =>
        session?.kind === 'member' ? this.communityStampService.packs(session.tenantId) : of([]),
      ),
    ),
    { initialValue: [] },
  );

  /** 自分が使えるコミュニティのパック(ルートのパックが先、次に連携コミュニティのパック)と、組み込みのパック。 */
  readonly packs = computed<PanelPack[]>(() => {
    const session = this.session();
    const community: PanelPack[] =
      session?.kind === 'member'
        ? this.communityPacks()
            .filter((pack) => canUseStampPack(pack, session))
            .sort(
              (a, b) =>
                Number(a.scope.type === 'community') - Number(b.scope.type === 'community') ||
                a.name.localeCompare(b.name, 'ja'),
            )
            .map((pack) => {
              const stamps = sortedStamps(pack)
                .filter((stamp) => !stamp.hidden)
                .map((stamp) => ({
                  id: stamp.id,
                  text: stamp.text,
                  url: communityStampImageUrl(session.tenantId, pack.id, stamp.id),
                }));
              return { packId: pack.id, name: pack.name, iconUrl: stamps[0]?.url ?? null, stamps };
            })
            .filter((pack) => pack.stamps.length > 0)
        : [];
    const builtIn: PanelPack[] = VISIBLE_STAMP_PACKS.map((pack) => ({
      packId: pack.packId,
      name: pack.name,
      iconUrl: stampImageUrl({ packId: pack.packId, stampId: pack.stamps[0].id }),
      stamps: pack.stamps.map((stamp) => ({
        id: stamp.id,
        text: stamp.text,
        url: stampImageUrl({ packId: pack.packId, stampId: stamp.id }) ?? '',
      })),
    }));
    return [...community, ...builtIn];
  });

  readonly myMemberId = computed(() => {
    const session = this.session();
    return session?.kind === 'member' ? session.memberId : '';
  });

  /** 選んだタブ。未選択(null)なら先頭のパック。 */
  private readonly chosenPackId = signal<string | null>(null);
  readonly activePackId = computed(() => this.chosenPackId() ?? this.packs()[0]?.packId ?? CUSTOM_STAMP_PACK_ID);
  readonly activePack = computed(() => this.packs().find((p) => p.packId === this.activePackId()) ?? null);

  choose(packId: string): void {
    this.chosenPackId.set(packId);
  }
}
