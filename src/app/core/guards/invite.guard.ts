import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { filter, map, take } from 'rxjs';
import { AuthService, canInvite } from '../services/auth.service';

/**
 * 招待の画面(/connect・/connect/send)のガード。招待できるのは、正規の会員と、連携コミュニティのメンバー
 * (自分が所属する連携コミュニティへ)。それ以外のゲストは出会いを探すへ移す(サーバー側でも拒否する)。
 */
export const inviteGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.session$.pipe(
    filter((session) => session !== undefined),
    take(1),
    map((session) => (canInvite(session) ? true : router.createUrlTree(['/connect/search']))),
  );
};
