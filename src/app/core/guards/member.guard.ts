import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { filter, map, take } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * 会員エリアのガード。canMatch で使い、未ログインのときは会員エリアのチャンク
 * (Firestore SDKを含む)を読み込む前に /login へ転送する。
 */
export const memberGuard: CanMatchFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.session$.pipe(
    filter((session) => session !== undefined),
    take(1),
    map((session) => (session?.kind === 'member' ? true : router.createUrlTree(['/login']))),
  );
};
