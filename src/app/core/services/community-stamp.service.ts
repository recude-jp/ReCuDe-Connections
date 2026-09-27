import { Injectable, inject } from '@angular/core';
import { Firestore, collection, collectionData } from '@angular/fire/firestore';
import { Observable, shareReplay } from 'rxjs';
import type { CommunityStamp, CommunityStampPack } from '../models/firestore.models';
import type { MemberSession } from './auth.service';
import { publicStorageUrl } from '../utils/storage-url';

export type CommunityStampPackRow = CommunityStampPack & { id: string };
export type CommunityStampRow = CommunityStamp & { id: string };

/** パックのスタンプを並び順に並べる(hidden を含めるかは呼び出し側で決める)。 */
export function sortedStamps(pack: CommunityStampPack): CommunityStampRow[] {
  return Object.entries(pack.stamps)
    .map(([id, stamp]) => ({ ...stamp, id }))
    .sort((a, b) => a.order - b.order);
}

/** その会員がパックのスタンプを送れるか(firestore.rules の canUseCommunityStamp と揃える)。 */
export function canUseStampPack(pack: CommunityStampPack, session: MemberSession): boolean {
  if (pack.hidden) {
    return false;
  }
  return pack.scope.type === 'root'
    ? !session.isGuest
    : !!pack.scope.communityId && session.communityIds.includes(pack.scope.communityId);
}

export function communityStampImagePath(tenantId: string, packId: string, stampId: string): string {
  return `tenants/${tenantId}/stampPacks/${packId}/${stampId}`;
}

/** コミュニティのスタンプの画像のURL(公開読み取り。上書きしないため長期間キャッシュできる)。 */
export function communityStampImageUrl(tenantId: string, packId: string, stampId: string): string {
  return publicStorageUrl(communityStampImagePath(tenantId, packId, stampId));
}

/**
 * コミュニティのスタンプ(管理 A2)。ルートコミュニティ・連携コミュニティごとのパックを、テナント全体で1回だけ購読する
 * (スタンプパネルと、メッセージのスタンプの表示で共有する)。会員エリアのルート(member.routes.ts)で提供する。
 */
@Injectable()
export class CommunityStampService {
  private readonly firestore = inject(Firestore);
  private readonly packsByTenant = new Map<string, Observable<CommunityStampPackRow[]>>();

  /** テナントの全パック(非表示のものを含む。送信済みのメッセージの表示に使う)。 */
  packs(tenantId: string): Observable<CommunityStampPackRow[]> {
    let packs = this.packsByTenant.get(tenantId);
    if (!packs) {
      packs = (
        collectionData(collection(this.firestore, `tenants/${tenantId}/stampPacks`), { idField: 'id' }) as Observable<
          CommunityStampPackRow[]
        >
      ).pipe(shareReplay({ bufferSize: 1, refCount: true }));
      this.packsByTenant.set(tenantId, packs);
    }
    return packs;
  }
}
