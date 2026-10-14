import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { createHash } from 'crypto';
import webpush from 'web-push';
import { requireCallerIdentity } from './callerIdentity';
import { appBaseUrl } from './twilio';

/**
 * プッシュ通知(Web Push / VAPID)。ホーム画面に追加したアプリ(PWA)に、新着メッセージなどを知らせ、
 * アイコンのバッジ(未読のメッセージの合計)を更新する。
 *
 * 端末の登録は pushSubscriptions/[endpoint の sha256] に置く(1つの端末=1つの会員。別の会員でログインし直すと上書き)。
 * クライアントは直接読み書きせず、savePushSubscription / deletePushSubscription を通す。
 * トークは端末どうしで暗号化しているため、通知にメッセージの中身は入れない(送った人の名前とルーム名だけ)。
 */

/** VAPID の公開鍵(クライアントの environment.ts の vapidPublicKey と同じ値)。 */
export const VAPID_PUBLIC_KEY =
  'BEd8ac3Ev9Gae7c7B1ynSGjZOrfCTImzA7XwHVDTkeCTKfZugkvBmjn6z3JIkEgQT_2xGUeO6Ganrt1UscTwW7Q';
const vapidPrivateKey = defineSecret('VAPID_PRIVATE_KEY');

/** 通知を送る関数の config に渡す secrets 宣言。 */
export const pushSecrets = [vapidPrivateKey];

/** プッシュサービスが通知を預かる時間(端末がオフラインでも、この間につながれば届く)。 */
const TTL_SECONDS = 24 * 60 * 60;

export interface PushSubscriptionDoc {
  tenantId: string;
  memberId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent: string;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
}

export interface PushNotice {
  title: string;
  body: string;
  /** 通知を押したときに開く画面(アプリ内のパス)。 */
  url: string;
  /** 同じタグの通知は1つにまとめる(ルームごとなど)。 */
  tag: string;
}

const db = () => admin.firestore();

function subscriptionId(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex');
}

function parseSubscription(value: unknown): { endpoint: string; keys: { p256dh: string; auth: string } } {
  const sub = (value ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof sub.endpoint === 'string' ? sub.endpoint : '';
  const p256dh = typeof sub.keys?.p256dh === 'string' ? sub.keys.p256dh : '';
  const auth = typeof sub.keys?.auth === 'string' ? sub.keys.auth : '';
  let url: URL | null = null;
  try {
    url = new URL(endpoint);
  } catch {
    url = null;
  }
  if (!url || url.protocol !== 'https:' || endpoint.length > 2000 || !p256dh || p256dh.length > 200 || !auth || auth.length > 100) {
    throw new HttpsError('invalid-argument', '通知の登録情報が正しくありません。');
  }
  return { endpoint, keys: { p256dh, auth } };
}

/** この端末で通知を受け取る(ログイン中の会員に結び付ける)。ログインのたびに呼んで、登録を新しくしておく。 */
export const savePushSubscription = onCall(async (request) => {
  const caller = requireCallerIdentity(request.auth);
  const { endpoint, keys } = parseSubscription((request.data ?? {}).subscription);
  const userAgent = String(request.rawRequest?.headers['user-agent'] ?? '').slice(0, 300);
  const ref = db().doc(`pushSubscriptions/${subscriptionId(endpoint)}`);
  await db().runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    tx.set(ref, {
      tenantId: caller.tenantId,
      memberId: caller.memberId,
      endpoint,
      keys,
      userAgent,
      createdAt: existing.exists ? existing.get('createdAt') : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    } satisfies PushSubscriptionDoc);
  });
  return { saved: true };
});

/** この端末で通知を受け取るのをやめる(通知をオフにしたとき・ログアウトするとき)。 */
export const deletePushSubscription = onCall(async (request) => {
  const caller = requireCallerIdentity(request.auth);
  const endpoint = (request.data ?? {}).endpoint;
  if (typeof endpoint !== 'string' || !endpoint) {
    throw new HttpsError('invalid-argument', '通知の登録情報が正しくありません。');
  }
  const ref = db().doc(`pushSubscriptions/${subscriptionId(endpoint)}`);
  const snap = await ref.get();
  const data = snap.data() as PushSubscriptionDoc | undefined;
  if (data && data.tenantId === caller.tenantId && data.memberId === caller.memberId) {
    await ref.delete();
  }
  return { deleted: true };
});

/** VAPID の連絡先(https の URL か mailto)。開発環境の http://localhost は使えないため、そのときは仮のアドレスにする。 */
function vapidSubject(): string {
  const base = appBaseUrl.value();
  return base.startsWith('https://') ? base : 'mailto:noreply@example.com';
}

/** アイコンのバッジに出す数(未読のメッセージの合計。アプリのメニューの「トーク」のバッジと同じ)。 */
async function unreadTotal(tenantId: string, memberId: string): Promise<number> {
  const snap = await db().collection(`tenants/${tenantId}/members/${memberId}/threads`).select('unreadCount').get();
  return snap.docs.reduce((total, d) => total + (Number(d.get('unreadCount')) || 0), 0);
}

/**
 * 会員の登録済みの端末すべてに通知を送る。送れなくなった登録(アンインストール・許可の取り消し)は消す。
 * 失敗しても呼び出し元の処理は止めない(ログだけ残す)。
 */
export async function sendPushToMember(tenantId: string, memberId: string, notice: PushNotice): Promise<void> {
  try {
    const subs = await db()
      .collection('pushSubscriptions')
      .where('tenantId', '==', tenantId)
      .where('memberId', '==', memberId)
      .get();
    if (subs.empty) {
      return;
    }
    const badge = await unreadTotal(tenantId, memberId);
    // notification は Angular のサービスワーカー(ngsw)が表示する形。appBadge は sw.js がアイコンのバッジに反映する。
    const payload = JSON.stringify({
      notification: {
        title: notice.title,
        body: notice.body,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-96x96.png',
        tag: notice.tag,
        renotify: true,
        data: {
          url: notice.url,
          onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: notice.url } },
        },
      },
      appBadge: badge,
    });
    const options: webpush.RequestOptions = {
      TTL: TTL_SECONDS,
      urgency: 'high',
      vapidDetails: { subject: vapidSubject(), publicKey: VAPID_PUBLIC_KEY, privateKey: vapidPrivateKey.value() },
    };
    await Promise.all(
      subs.docs.map(async (doc) => {
        const sub = doc.data() as PushSubscriptionDoc;
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, options);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await doc.ref.delete();
          } else {
            logger.warn('プッシュ通知を送れませんでした', { status, memberId });
          }
        }
      }),
    );
  } catch (err) {
    logger.error('プッシュ通知の送信に失敗しました', err);
  }
}

/** 会員の表示名(通知の文に使う)。 */
export async function displayNameOf(tenantId: string, memberId: string): Promise<string> {
  const snap = await db().doc(`tenants/${tenantId}/members/${memberId}`).get();
  return (snap.get('displayName') as string | undefined) || 'メンバー';
}
