import { Injectable } from '@angular/core';
import type { TenantBranding } from '../models/firestore.models';
import { environment } from '../../../environments/environment';

/** Firestore REST API の値の形(使うのは文字列フィールドだけ)。 */
interface RestDocument {
  fields?: {
    name?: { stringValue?: string };
    branding?: { mapValue?: { fields?: Record<string, { stringValue?: string }> } };
  };
}

export interface PublicTenantInfo {
  name: string;
  branding: TenantBranding;
}

/**
 * ログイン前の画面(/login)で、テナントの名称・ブランド(サービス名・ロゴ)を表示するための取得。
 * テナントドキュメントは未ログインでも読める(firestore.rules)ので、Firestore SDK(約440kB)を
 * 初回読み込みに含めないよう、REST API を fetch で1回だけ呼ぶ。
 */
@Injectable({ providedIn: 'root' })
export class PublicBrandingService {
  async getTenant(tenantId: string): Promise<PublicTenantInfo | undefined> {
    const { projectId } = environment.firebase;
    const origin = environment.useEmulators ? 'http://localhost:8080' : 'https://firestore.googleapis.com';
    const url = `${origin}/v1/projects/${projectId}/databases/(default)/documents/tenants/${encodeURIComponent(tenantId)}`;

    const res = await fetch(url);
    if (!res.ok) {
      return undefined;
    }
    const doc = (await res.json()) as RestDocument;
    const branding = doc.fields?.branding?.mapValue?.fields ?? {};
    return {
      name: doc.fields?.name?.stringValue ?? '',
      branding: {
        siteTitle: branding['siteTitle']?.stringValue,
        logoUrl: branding['logoUrl']?.stringValue,
        faviconUrl: branding['faviconUrl']?.stringValue,
      },
    };
  }
}
