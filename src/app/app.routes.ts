import { Routes } from '@angular/router';
import { memberGuard } from './core/guards/member.guard';
import { landingGuard } from './core/guards/landing.guard';

export const routes: Routes = [
  // トップページ(サービスの紹介)。ログイン前に誰でも見られる。ログイン中の会員はトークへ転送する。
  {
    path: '',
    pathMatch: 'full',
    canMatch: [landingGuard],
    loadComponent: () => import('./features/landing/landing').then((m) => m.Landing),
  },
  {
    path: 'about',
    loadComponent: () => import('./features/landing/landing').then((m) => m.Landing),
  },
  {
    path: 'login',
    loadComponent: () => import('./features/member-login/member-login').then((m) => m.MemberLogin),
  },
  // 招待の申請(会員に知り合いがいない人向けの公開フォーム)。事務局が確認して招待を送る。
  {
    path: 'request',
    loadComponent: () => import('./features/invite-request/invite-request').then((m) => m.InviteRequestPage),
  },
  {
    path: 'join',
    loadComponent: () => import('./features/join/join').then((m) => m.Join),
  },

  // 旧URL(Milestone 4まで)からの転送。会員エリアより前に置く(会員エリアのチャンクを読み込まずに転送するため)。
  { path: 'dashboard', pathMatch: 'full', redirectTo: 'mypage' },
  { path: 'dashboard/passkeys', redirectTo: 'mypage/passkeys' },
  // 招待はつながるの先頭(/connect: QRコード、/connect/send: 招待の送付)。出会いを探すは /connect/search。
  { path: 'invite', redirectTo: 'connect/send' },
  { path: 'invites', redirectTo: 'connect' },
  { path: 'mypage/invite', redirectTo: 'connect/send' },
  { path: 'mypage/invites', redirectTo: 'connect' },
  { path: 'connect/invite', redirectTo: 'connect/send' },
  { path: 'connect/invites', redirectTo: 'connect' },
  { path: 'search', redirectTo: 'connect/search' },
  { path: 'connect/requests', redirectTo: 'connect/search' },
  { path: 'connections', redirectTo: 'talk' },
  // 1対1チャットはルーム方式に移行した(roomId = connectionId)。
  { path: 'chat/:connectionId', redirectTo: 'talk/rooms/:connectionId' },
  { path: 'talk/chat/:connectionId', redirectTo: 'talk/rooms/:connectionId' },

  // 旧方式の事務局専用ログイン(メール＋パスワード)は廃止。管理者も会員と同じ /login からログインする。
  { path: 'admin/login', redirectTo: 'login' },
  { path: 'admin/settings/passkeys', redirectTo: 'mypage/passkeys' },

  // 会員向け画面: メイン4機能(トーク/つながる/イベント/マイページ)と管理画面。
  // canMatch のため、未ログインのときは会員エリアのチャンク(Firestore SDKを含む)を読み込まない。
  {
    path: '',
    canMatch: [memberGuard],
    loadChildren: () => import('./member.routes').then((m) => m.MEMBER_ROUTES),
  },
  { path: '**', redirectTo: 'login' },
];
