import { Injectable, inject } from '@angular/core';
import { Firestore, FieldPath, collection, collectionData, query, where } from '@angular/fire/firestore';
import { Observable, combineLatest, distinctUntilChanged, map, of, shareReplay, switchMap } from 'rxjs';
import { AuthService, MemberSession, canUseAdmin } from './auth.service';
import { MemberService } from './member.service';
import { RoomService } from './room.service';
import type { Member } from '../models/firestore.models';
import { isFullMember } from '../utils/membership';

const sum = (counts: number[]) => counts.reduce((total, count) => total + count, 0);

/**
 * メニューのバッジの件数。トークは未読のメッセージの合計(トーク一覧の unreadCount の合計)、
 * 管理は審査待ちの申請の合計(ルートの会員申請＋管理している連携コミュニティの参加の申請)。
 * 会員エリアのルート(member.routes.ts)で提供する。
 */
@Injectable()
export class NotificationBadgeService {
  private readonly auth = inject(AuthService);
  private readonly firestore = inject(Firestore);
  private readonly memberService = inject(MemberService);
  private readonly roomService = inject(RoomService);

  private readonly memberSession$ = this.auth.session$.pipe(
    map((session) => (session?.kind === 'member' ? session : null)),
    distinctUntilChanged(
      (a, b) =>
        a?.memberId === b?.memberId &&
        a?.isAdmin === b?.isAdmin &&
        a?.adminCommunityIds.join() === b?.adminCommunityIds.join(),
    ),
  );

  /** 未読のメッセージの合計。 */
  readonly unreadTotal$: Observable<number> = this.memberSession$.pipe(
    switchMap((session) =>
      session
        ? this.roomService.listThreads(session.tenantId, session.memberId).pipe(map((threads) => sum(threads.map((t) => t.unreadCount ?? 0))))
        : of(0),
    ),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  /** 審査待ちの申請の合計(管理画面に入れない人は 0)。 */
  readonly pendingApplications$: Observable<number> = this.memberSession$.pipe(
    switchMap((session) => (session && canUseAdmin(session) ? this.pendingFor(session) : of(0))),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  private pendingFor(session: MemberSession): Observable<number> {
    const members = collection(this.firestore, `tenants/${session.tenantId}/members`);
    const count = (ref: ReturnType<typeof query>, filter: (m: Member) => boolean = () => true) =>
      (collectionData(ref) as Observable<Member[]>).pipe(map((list) => list.filter(filter).length));

    // ルートの会員申請(ルートの管理者だけ)。
    const root$ = session.isAdmin
      ? count(query(members, where('membershipApplication.status', '==', 'pending')), (m) => !isFullMember(m))
      : of(0);
    // 連携コミュニティの参加の申請(ルートの管理者は全部の連携コミュニティ、連携コミュニティの管理者はその連携コミュニティ)。
    const communityIds$ = session.isAdmin
      ? this.memberService.listCommunities(session.tenantId).pipe(map((list) => list.map((c) => c.id)))
      : of(session.adminCommunityIds);
    const communities$ = communityIds$.pipe(
      distinctUntilChanged((a, b) => a.join() === b.join()),
      switchMap((ids) =>
        ids.length === 0
          ? of(0)
          : combineLatest(
              ids.map((id) =>
                count(query(members, where(new FieldPath('communityApplications', id, 'status'), '==', 'pending'))),
              ),
            ).pipe(map(sum)),
      ),
    );
    return combineLatest([root$, communities$]).pipe(map(sum));
  }
}
