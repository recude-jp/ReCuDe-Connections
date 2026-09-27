import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { requireAdmin } from './callerIdentity';

/**
 * 管理者がテナントのサービス名(サイトタイトル)・アイコン(ロゴ)・ファビコンを設定する。
 * ロゴ画像自体はクライアントからFirebase Storageへ直接アップロードし、
 * ここではそのダウンロードURLをテナントドキュメントに保存するだけ。
 */
export const updateTenantBranding = onCall(async (request) => {
  const { identity } = await requireAdmin(request.auth);

  const { siteTitle, logoUrl, faviconUrl } = (request.data ?? {}) as {
    siteTitle?: string;
    logoUrl?: string;
    faviconUrl?: string;
  };

  const branding: Record<string, string> = {};
  if (typeof siteTitle === 'string') {
    branding['siteTitle'] = siteTitle.trim();
  }
  if (typeof logoUrl === 'string') {
    branding['logoUrl'] = logoUrl;
  }
  if (typeof faviconUrl === 'string') {
    branding['faviconUrl'] = faviconUrl;
  }

  await admin.firestore().doc(`tenants/${identity.tenantId}`).set({ branding }, { merge: true });

  return { status: 'ok' };
});
