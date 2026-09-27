import { Component, effect, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/services/auth.service';
import { MyStampService } from '../../core/services/my-stamp.service';
import { COMMUNITY_STAMP_PACK_PREFIX, CUSTOM_STAMP_PACK_ID, type StampRef } from '../../core/models/firestore.models';
import { CommunityStampService, communityStampImageUrl } from '../../core/services/community-stamp.service';
import { switchMap, of } from 'rxjs';
import { stampImageUrl, stampText } from '../../core/utils/stamps';

/**
 * スタンプの画像。組み込みのパックはアプリ同梱の画像、マイスタンプ(packId: 'custom')とコミュニティのスタンプ
 * (packId が tp- で始まる)は Storage の画像を出す。
 * 見つからない(削除された)スタンプは「削除されたスタンプ」と表示する。
 */
@Component({
  selector: 'app-stamp-image',
  template: `
    @if (url(); as src) {
      <img
        [src]="src"
        [alt]="alt()"
        [width]="size()"
        [height]="size()"
        [style.width.px]="size()"
        [style.height.px]="size()"
        (error)="onImageError()"
      />
    } @else if (missing()) {
      <span class="missing">（削除されたスタンプ）</span>
    } @else {
      <span class="loading" [style.width.px]="size()" [style.height.px]="size()"></span>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    img,
    .loading {
      display: block;
    }
    .missing {
      display: inline-block;
      padding: 8px 12px;
      border-radius: 16px;
      background: #fff;
      color: #a8a29e;
      font-size: 0.85rem;
    }
  `,
})
export class StampImage {
  private readonly auth = inject(AuthService);
  private readonly myStamps = inject(MyStampService);
  private readonly communityStamps = inject(CommunityStampService);

  readonly stamp = input.required<StampRef>();
  readonly size = input(140);
  /** 代替テキスト(マイスタンプの名前など。省略時は組み込みスタンプの文言)。 */
  readonly label = input<string>('');

  private readonly session = toSignal(this.auth.session$, { initialValue: undefined });
  /** コミュニティのスタンプの文言(代替テキスト)を引くためのパックの一覧。 */
  private readonly communityPacks = toSignal(
    this.auth.session$.pipe(
      switchMap((session) => (session?.kind === 'member' ? this.communityStamps.packs(session.tenantId) : of([]))),
    ),
    { initialValue: [] },
  );

  readonly url = signal<string | null>(null);
  readonly missing = signal(false);
  readonly alt = signal('スタンプ');

  constructor() {
    effect(() => {
      const stamp = this.stamp();
      const session = this.session();
      this.url.set(null);
      this.missing.set(false);
      this.alt.set(this.label() || (stamp.packId === CUSTOM_STAMP_PACK_ID ? 'マイスタンプ' : stampText(stamp)));

      if (stamp.packId.startsWith(COMMUNITY_STAMP_PACK_PREFIX)) {
        const pack = this.communityPacks().find((p) => p.id === stamp.packId);
        this.alt.set(this.label() || pack?.stamps[stamp.stampId]?.text || 'スタンプ');
        if (session?.kind === 'member') {
          this.url.set(communityStampImageUrl(session.tenantId, stamp.packId, stamp.stampId));
        }
        return;
      }
      if (stamp.packId !== CUSTOM_STAMP_PACK_ID) {
        const url = stampImageUrl(stamp);
        this.url.set(url);
        this.missing.set(!url);
        return;
      }
      if (!stamp.ownerId || session?.kind !== 'member') {
        this.missing.set(!stamp.ownerId);
        return;
      }
      this.myStamps
        .getImageUrl(session.tenantId, stamp.ownerId, stamp.stampId)
        .then((url) => this.url.set(url))
        .catch(() => this.missing.set(true));
    });
  }

  /** 画像を読み込めなかった(削除された)ときは「削除されたスタンプ」にする。 */
  onImageError(): void {
    this.url.set(null);
    this.missing.set(true);
  }
}
