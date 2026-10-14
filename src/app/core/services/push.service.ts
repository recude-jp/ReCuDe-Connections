import { Injectable, inject, signal } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * この端末での通知の状態。
 * unsupported: 通知に対応していない。needs-install: iPhone・iPad で、ホーム画面に追加していない(追加すると使える)。
 * denied: 端末の設定で通知をブロックしている。off: 受け取っていない。on: 受け取っている。
 */
export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on';

/**
 * プッシュ通知(Web Push)。この端末で通知を受け取る登録をサーバー(pushSubscriptions)に送り、
 * ホーム画面のアイコンのバッジ(未読のメッセージの合計)を更新する。サーバー側は functions/src/push.ts。
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly swPush = inject(SwPush);
  private readonly functions = inject(Functions);

  readonly state = signal<PushState>('unsupported');

  /** iPhone・iPad か(iPadOS の Safari は Mac と名乗るため、タッチ対応かどうかでも見分ける)。 */
  isIos(): boolean {
    const ua = navigator.userAgent;
    return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }

  /** ホーム画面に追加したアプリとして開いているか。 */
  isStandalone(): boolean {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  }

  private supported(): boolean {
    return this.swPush.isEnabled && 'Notification' in window && 'PushManager' in window;
  }

  /** 今の状態を調べ直す(設定の画面を開いたときなど)。 */
  async refresh(): Promise<PushState> {
    let next: PushState;
    if (!this.supported()) {
      next = this.isIos() && !this.isStandalone() ? 'needs-install' : 'unsupported';
    } else if (Notification.permission === 'denied') {
      next = 'denied';
    } else {
      next = (await this.currentSubscription()) && Notification.permission === 'granted' ? 'on' : 'off';
    }
    this.state.set(next);
    return next;
  }

  /** 通知をオンにする(許可を求める画面は、ボタンを押したときにしか出せないため、クリックから呼ぶ)。 */
  async enable(): Promise<void> {
    const subscription = await this.swPush.requestSubscription({ serverPublicKey: environment.vapidPublicKey });
    await this.save(subscription);
    this.state.set('on');
  }

  /** 通知をオフにする。 */
  async disable(): Promise<void> {
    const subscription = await this.currentSubscription();
    if (subscription) {
      await this.remove(subscription.endpoint).catch(() => undefined);
      await this.swPush.unsubscribe().catch(() => undefined);
    }
    await this.refresh();
  }

  /**
   * ログイン中に呼ぶ。通知を受け取っている端末なら、登録をログイン中の会員に結び付け直す
   * (登録は端末ごとに変わることがあり、別の会員でログインし直したときにも付け替える)。
   */
  async syncSubscription(): Promise<void> {
    if (!this.supported() || Notification.permission !== 'granted') {
      return;
    }
    const subscription = await this.currentSubscription();
    if (subscription) {
      await this.save(subscription).catch(() => undefined);
    }
  }

  /** ログアウトの前に呼ぶ。この端末に、ログアウトした会員あての通知が届かないようにする。 */
  async releaseForSignOut(): Promise<void> {
    this.setBadge(0);
    if (!this.supported()) {
      return;
    }
    const subscription = await this.currentSubscription();
    if (subscription) {
      await this.remove(subscription.endpoint).catch(() => undefined);
    }
  }

  /** ホーム画面のアイコンのバッジ(対応していない端末では何もしない)。 */
  setBadge(count: number): void {
    const nav = navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (!nav.setAppBadge || !nav.clearAppBadge) {
      return;
    }
    void (count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge()).catch(() => undefined);
  }

  private currentSubscription(): Promise<PushSubscription | null> {
    return firstValueFrom(this.swPush.subscription);
  }

  private async save(subscription: PushSubscription): Promise<void> {
    const json = subscription.toJSON();
    await httpsCallable(this.functions, 'savePushSubscription')({
      subscription: { endpoint: json.endpoint, keys: json.keys },
    });
  }

  private async remove(endpoint: string): Promise<void> {
    await httpsCallable(this.functions, 'deletePushSubscription')({ endpoint });
  }
}
