import { Injectable, inject } from '@angular/core';
import { Firestore, FieldPath, collection, collectionData, query, where } from '@angular/fire/firestore';
import { Observable, combineLatest, distinctUntilChanged, map, of, shareReplay, switchMap } from 'rxjs';
import { AuthService, MemberSession, canUseAdmin } from './auth.service';
import { MemberService } from './member.service';
import { ROOT_SCOPE_KEY } from './admin-scope.service';
import { RoomService } from './room.service';
import type { Member } from '../models/firestore.models';
import { isFullMember } from '../utils/membership';

const sum = (counts: number[]) => counts.reduce((total, count) => total + count, 0);

/**
 * メニューのバッジの件数。トークは未読のメッセージの合計(トーク一覧の unreadCount の合計)、
 * 管理は審査待ちの申請の合計(ルートの会員申請＋管理している連携コミュニティの参加の申請＋招待申請)。
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

  /**
   * 審査待ちの申請の件数を、管理画面の対象(ルート 'root'・連携コミュニティのID)ごとに数えたもの。
   * 管理画面のタブ(会員申請)と、対象の切り替えメニューのバッジに使う。管理画面に入れない人は空。
   */
  readonly pendingByScope$: Observable<Record<string, number>> = this.memberSession$.pipe(
    switchMap((session) => (session && canUseAdmin(session) ? this.pendingFor(session) : of({}))),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  /** 確認待ちの招待申請(トップページの公開フォームから届くもの)。読めるのはルートの管理者だけ。 */
  readonly pendingInviteRequests$: Observable<number> = this.memberSession$.pipe(
    switchMap((session) =>
      session?.isAdmin
        ? collectionData(
            query(collection(this.firestore, `tenants/${session.tenantId}/inviteRequests`), where('status', '==', 'pending')),
          ).pipe(map((list) => list.length))
        : of(0),
    ),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  /** メニューの「管理」のバッジ: 審査待ちの申請と、確認待ちの招待申請の合計(管理画面に入れない人は 0)。 */
  readonly pendingApplications$: Observable<number> = combineLatest([
    this.pendingByScope$,
    this.pendingInviteRequests$,
  ]).pipe(map(([byScope, inviteRequests]) => sum(Object.values(byScope)) + inviteRequests));

  private pendingFor(session: MemberSession): Observable<Record<string, number>> {
    const members = collection(this.firestore, `tenants/${session.tenantId}/members`);
    const count = (ref: ReturnType<typeof query>, filter: (m: Member) => boolean = () => true) =>
      (collectionData(ref) as Observable<Member[]>).pipe(map((list) => list.filter(filter).length));

    // ルートの会員申請(ルートの管理者だけ)。
    const root$: Observable<Record<string, number>> = session.isAdmin
      ? count(query(members, where('membershipApplication.status', '==', 'pending')), (m) => !isFullMember(m)).pipe(
          map((n) => ({ [ROOT_SCOPE_KEY]: n })),
        )
      : of({});
    // 連携コミュニティの参加の申請(ルートの管理者は全部の連携コミュニティ、連携コミュニティの管理者はその連携コミュニティ)。
    const communityIds$ = session.isAdmin
      ? this.memberService.listCommunities(session.tenantId).pipe(map((list) => list.map((c) => c.id)))
      : of(session.adminCommunityIds);
    const communities$: Observable<Record<string, number>> = communityIds$.pipe(
      distinctUntilChanged((a, b) => a.join() === b.join()),
      switchMap((ids) =>
        ids.length === 0
          ? of({})
          : combineLatest(
              ids.map((id) =>
                count(query(members, where(new FieldPath('communityApplications', id, 'status'), '==', 'pending'))).pipe(
                  map((n) => [id, n] as const),
                ),
              ),
            ).pipe(map((entries) => Object.fromEntries(entries))),
      ),
    );
    return combineLatest([root$, communities$]).pipe(map(([root, communities]) => ({ ...root, ...communities })));
  }
}
