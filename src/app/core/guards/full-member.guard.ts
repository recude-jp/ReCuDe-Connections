import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { filter, map, take } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * 正規の会員だけが使える画面のガード(招待・グループの作成など)。
 * ゲストはトーク・出会いを探す・イベントの参照だけができるため、出会いを探すへ移す(サーバー側でも拒否する)。
 */
export const fullMemberGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.session$.pipe(
    filter((session) => session !== undefined),
    take(1),
    map((session) => (session?.kind === 'member' && !session.isGuest ? true : router.createUrlTree(['/connect/search']))),
  );
};
