import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Storage, ref, uploadBytes, getDownloadURL } from '@angular/fire/storage';

/** サービス設定画面のルートで提供する(Storage SDKはこの画面でしか使わないため)。 */
@Injectable()
export class TenantBrandingService {
  private readonly functions = inject(Functions);
  private readonly storage = inject(Storage);

  async updateBranding(siteTitle?: string, logoUrl?: string, faviconUrl?: string): Promise<void> {
    const fn = httpsCallable<{ siteTitle?: string; logoUrl?: string; faviconUrl?: string }, { status: 'ok' }>(
      this.functions,
      'updateTenantBranding',
    );
    await fn({ siteTitle, logoUrl, faviconUrl });
  }

  /** ロゴ画像をテナント配下の固定パスにアップロードし、ダウンロードURLを返す(既存ファイルは上書き)。 */
  async uploadLogo(tenantId: string, file: File): Promise<string> {
    return this.upload(`tenants/${tenantId}/branding/logo`, file, file.type);
  }

  /** ロゴ画像から作ったファビコン(PNG)をアップロードし、ダウンロードURLを返す(既存ファイルは上書き)。 */
  async uploadFavicon(tenantId: string, blob: Blob): Promise<string> {
    return this.upload(`tenants/${tenantId}/branding/favicon`, blob, 'image/png');
  }

  /**
   * 同じパスに上書きするため、URLの末尾に更新時刻を付けて、ブラウザのキャッシュに古い画像が残らないようにする
   * (Storage はこのパラメータを無視する)。
   */
  private async upload(path: string, data: Blob, contentType: string): Promise<string> {
    const fileRef = ref(this.storage, path);
    await uploadBytes(fileRef, data, { contentType });
    return `${await getDownloadURL(fileRef)}&v=${Date.now()}`;
  }
}
