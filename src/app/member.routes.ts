import { Routes } from '@angular/router';
import { getFirestore, provideFirestore, connectFirestoreEmulator } from '@angular/fire/firestore';
import { getStorage, provideStorage, connectStorageEmulator } from '@angular/fire/storage';
import { adminGuard } from './core/guards/admin.guard';
import { fullMemberGuard } from './core/guards/full-member.guard';
import { inviteGuard } from './core/guards/invite.guard';
import { MemberService } from './core/services/member.service';
import { ConnectionService } from './core/services/connection.service';
import { RoomService } from './core/services/room.service';
import { MemberSearchService } from './core/services/member-search.service';
import { MyStampService } from './core/services/my-stamp.service';
import { CommunityStampService } from './core/services/community-stamp.service';
import { NotificationBadgeService } from './core/services/notification-badge.service';
import { environment } from '../environments/environment';

/**
 * 会員エリアのルート(app.routes.ts から loadChildren で遅延ロードする)。
 * Firestore SDK(約440kB)はここで初めて提供するため、ログイン前の画面(/login・/join)の
 * 初回読み込みには含まれない。Storage SDK(トークの画像・管理画面のロゴ)もここで提供する。
 * 管理画面は admin.routes.ts にさらに分ける。
 * Firestore・Storage を使うサービスは providedIn: 'root' にせず、ここで提供する。
 */
export const MEMBER_ROUTES: Routes = [
  {
    path: '',
    providers: [
      provideFirestore(() => {
        const firestore = getFirestore();
        if (environment.useEmulators) {
          connectFirestoreEmulator(firestore, 'localhost', 8080);
        }
        return firestore;
      }),
      provideStorage(() => {
        const storage = getStorage();
        if (environment.useEmulators) {
          connectStorageEmulator(storage, 'localhost', 9199);
        }
        return storage;
      }),
      MemberService,
      ConnectionService,
      RoomService,
      MemberSearchService,
      MyStampService,
      CommunityStampService,
      NotificationBadgeService,
    ],
    loadComponent: () => import('./shared/member-layout/member-layout').then((m) => m.MemberLayout),
    children: [
      // トーク: 左に一覧(サイドバー)、右に選んだルーム。1対1・グループ共通(SPEC 5章)。
      {
        path: 'talk',
        loadComponent: () => import('./features/talk/talk-layout/talk-layout').then((m) => m.TalkLayout),
        children: [
          {
            path: '',
            loadComponent: () => import('./features/talk/talk-home/talk-home').then((m) => m.TalkHome),
          },
          {
            path: 'new-group',
            canActivate: [fullMemberGuard],
            loadComponent: () => import('./features/talk/group-create/group-create').then((m) => m.GroupCreate),
          },
          {
            path: 'rooms/:roomId',
            loadComponent: () => import('./features/talk/talk-room/talk-room').then((m) => m.TalkRoom),
          },
          {
            path: 'rooms/:roomId/info',
            loadComponent: () => import('./features/talk/group-info/group-info').then((m) => m.GroupInfo),
          },
        ],
      },
      // つながる: 先頭が招待(正規の会員と連携コミュニティのメンバー。ほかのゲストは出会いを探すへ)、次が出会いを探す。
      {
        path: 'connect',
        pathMatch: 'full',
        canActivate: [inviteGuard],
        loadComponent: () => import('./features/invite-home/invite-home').then((m) => m.InviteHome),
      },
      {
        path: 'connect/send',
        canActivate: [inviteGuard],
        loadComponent: () =>
          import('./features/invite-candidate/invite-candidate').then((m) => m.InviteCandidate),
      },
      {
        path: 'connect/search',
        loadComponent: () => import('./features/member-search/member-search').then((m) => m.MemberSearch),
      },
      {
        path: 'events',
        loadComponent: () => import('./features/events/events').then((m) => m.Events),
      },
      // マイページ: 設定のカテゴリごとにタブで切り替える。
      {
        path: 'mypage',
        loadComponent: () => import('./features/mypage-layout/mypage-layout').then((m) => m.MyPageLayout),
        children: [
          {
            path: '',
            loadComponent: () => import('./features/mypage/mypage').then((m) => m.MyPage),
          },
          {
            path: 'stamps',
            loadComponent: () => import('./features/my-stamps/my-stamps').then((m) => m.MyStamps),
          },
          {
            path: 'membership',
            loadComponent: () =>
              import('./features/membership-application/membership-application').then(
                (m) => m.MembershipApplicationPage,
              ),
          },
          {
            path: 'passkeys',
            loadComponent: () =>
              import('./features/passkey-settings/passkey-settings').then((m) => m.PasskeySettings),
          },
        ],
      },

      // 管理画面: 管理者ロールを持つ会員だけが入れる(メニューバーの「管理」)。
      // canMatch のため、管理者以外は管理画面のチャンクを読み込まない。
      {
        path: 'admin',
        canMatch: [adminGuard],
        loadChildren: () => import('./admin.routes').then((m) => m.ADMIN_ROUTES),
      },
    ],
  },
];
