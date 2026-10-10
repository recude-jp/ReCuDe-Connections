import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { filter, map, take } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * トップページ(/)のガード。ログイン中の会員は、ホーム画面のアプリから開いたときと同じくトークへ転送する
 * (サービスの紹介は /about でいつでも見られる)。
 */
export const landingGuard: CanMatchFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.session$.pipe(
    filter((session) => session !== undefined),
    take(1),
    map((session) => (session?.kind === 'member' ? router.createUrlTree(['/talk']) : true)),
  );
};
