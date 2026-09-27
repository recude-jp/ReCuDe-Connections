import { inject } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router } from '@angular/router';
import { filter, map, take } from 'rxjs';
import { AuthService, canUseAdmin } from '../services/auth.service';
import { ROOT_SCOPE_KEY, canAdminScope } from '../services/admin-scope.service';

const settledSession = () =>
  inject(AuthService).session$.pipe(
    filter((session) => session !== undefined),
    take(1),
  );

/**
 * 管理画面(/admin)のガード。ルートコミュニティの管理者(管理者ロール)と、連携コミュニティの管理者だけを通す
 * (サーバー側でもルール・Functionsで確認する)。canMatch で使い、管理者以外には管理画面のチャンクを読み込ませない。
 */
export const adminGuard: CanMatchFn = () => {
  const router = inject(Router);
  return settledSession().pipe(
    map((session) => {
      if (session?.kind !== 'member') {
        return router.createUrlTree(['/login']);
      }
      return canUseAdmin(session) ? true : router.createUrlTree(['/talk']);
    }),
  );
};

/** 管理できる最初の対象(ルートの管理者はルート、連携コミュニティの管理者はその連携コミュニティ)。 */
function defaultScopeKey(session: { isAdmin: boolean; adminCommunityIds: string[] }): string {
  return session.isAdmin ? ROOT_SCOPE_KEY : (session.adminCommunityIds[0] ?? ROOT_SCOPE_KEY);
}

/** /admin を開いたときに、管理できる最初の対象の会員一覧へ移す。 */
export const adminEntryGuard: CanActivateFn = () => {
  const router = inject(Router);
  return settledSession().pipe(
    map((session) =>
      router.createUrlTree(['/admin', session?.kind === 'member' ? defaultScopeKey(session) : ROOT_SCOPE_KEY, 'members']),
    ),
  );
};

/**
 * 対象のコミュニティ(/admin/:scope)のガード。管理できない対象(旧URLの /admin/members などを含む)は、
 * 管理できる最初の対象の会員一覧へ移す。
 */
export const adminScopeGuard: CanActivateFn = (route) => {
  const router = inject(Router);
  const key = route.paramMap.get('scope') ?? '';
  return settledSession().pipe(
    map((session) => {
      if (session?.kind !== 'member') {
        return router.createUrlTree(['/login']);
      }
      return canAdminScope(session, key) ? true : router.createUrlTree(['/admin', defaultScopeKey(session), 'members']);
    }),
  );
};

/** ルートコミュニティだけのタブ(連携コミュニティの一覧)。連携コミュニティでは会員一覧へ移す。 */
export const rootScopeOnlyGuard: CanActivateFn = (route) => {
  const router = inject(Router);
  const key = route.parent?.paramMap.get('scope') ?? '';
  return key === ROOT_SCOPE_KEY ? true : router.createUrlTree(['/admin', key, 'members']);
};
