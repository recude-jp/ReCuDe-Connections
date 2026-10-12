import { Injectable, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { filter } from 'rxjs';

/** 開いてすぐ(この時間内)に新しい版が届いたときは、確かめずに読み込み直す(まだ何も入力していないため)。 */
const AUTO_RELOAD_WITHIN_MS = 20_000;
/** 開いたままのとき、新しい版を確かめる間隔。 */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/**
 * 新しい版のアプリが配られたら、端末に保存された古い版から入れ替える。
 * Service Worker は前回の版をすぐに表示し、新しい版は裏で読み込むため、何もしないと
 * デプロイの直後に開いた人は古い画面のまま操作することになる(古い画面が、もう使わない仕組みを呼ぶこともある)。
 * 開いてすぐなら自動で読み込み直し、使っている途中なら「新しいバージョンがあります」を出して本人に選んでもらう。
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private readonly swUpdate = inject(SwUpdate);
  private readonly startedAt = Date.now();

  /** 新しい版が読み込み済みで、読み込み直せば切り替わる。 */
  readonly updateReady = signal(false);

  start(): void {
    if (!this.swUpdate.isEnabled) {
      return;
    }
    this.swUpdate.versionUpdates.pipe(filter((event) => event.type === 'VERSION_READY')).subscribe(() => {
      if (Date.now() - this.startedAt < AUTO_RELOAD_WITHIN_MS) {
        this.reload();
      } else {
        this.updateReady.set(true);
      }
    });
    // 保存された版が壊れていて使えないときは、読み込み直して取り直す。
    this.swUpdate.unrecoverable.subscribe(() => this.reload());

    this.check();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.check();
      }
    });
    setInterval(() => this.check(), CHECK_INTERVAL_MS);
  }

  reload(): void {
    document.location.reload();
  }

  private check(): void {
    this.swUpdate.checkForUpdate().catch(() => undefined);
  }
}
