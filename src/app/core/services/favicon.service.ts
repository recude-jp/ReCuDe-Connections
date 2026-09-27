import { DOCUMENT, Injectable, inject } from '@angular/core';

/** テナントのアイコンが未設定のときのファビコン(index.html と同じ)。 */
const DEFAULT_FAVICON = 'favicon.ico';

/** 前回のアイコン・サービス名を覚えておく場所(index.html が、アプリの起動前に読んで反映する)。 */
const STORAGE_KEY = 'recude.branding';

/**
 * ブラウザのタブのアイコン(ファビコン)と、ホーム画面に追加したときのアイコン(apple-touch-icon)を
 * テナントのアイコンに切り替える。ログイン前の画面・会員エリアのどちらからも使う。
 * 次に開いたときにアプリの起動前から出せるよう、アイコンとサービス名をブラウザに覚えておく(index.html で反映する)。
 * PWAのマニフェスト(manifest.webmanifest)のアイコンは静的ファイルのため、ここでは変えられない。
 */
@Injectable({ providedIn: 'root' })
export class FaviconService {
  private readonly document = inject(DOCUMENT);
  private current: string | null | undefined;

  /** url が null なら既定のアイコンに戻す。 */
  apply(url: string | null | undefined): void {
    const next = url || null;
    if (next === this.current) {
      return;
    }
    this.current = next;
    this.remember({ icon: next });
    // href の書き換えだけでは更新しないブラウザ(Safariなど)があるため、要素ごと差し替える。
    this.replaceLink('icon', next ?? DEFAULT_FAVICON, next ? 'image/png' : 'image/x-icon');
    if (next) {
      this.replaceLink('apple-touch-icon', next, 'image/png');
    } else {
      this.document.head.querySelector('link[rel="apple-touch-icon"]')?.remove();
    }
  }

  /** サービス名(タブのタイトル)も覚えておく(タイトル自体は各画面が Title で設定する)。 */
  rememberTitle(title: string): void {
    this.remember({ title });
  }

  private remember(patch: { icon?: string | null; title?: string }): void {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') ?? {};
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, ...patch }));
    } catch {
      // 保存できない環境(プライベートブラウズなど)では、毎回アプリの起動後に反映するだけにする。
    }
  }

  private replaceLink(rel: string, href: string, type: string): void {
    this.document.head.querySelectorAll(`link[rel="${rel}"]`).forEach((link) => link.remove());
    const link = this.document.createElement('link');
    link.rel = rel;
    link.type = type;
    link.href = href;
    this.document.head.appendChild(link);
  }
}
