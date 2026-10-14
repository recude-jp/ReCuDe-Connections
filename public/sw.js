// アプリのサービスワーカー。Angular のサービスワーカー(画面のキャッシュ・更新・通知の表示)を読み込み、
// プッシュ通知で届いた未読の数を、ホーム画面のアイコンのバッジに出す(functions/src/push.ts の appBadge)。
importScripts('./ngsw-worker.js');

self.addEventListener('push', (event) => {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    data = null;
  }
  const count = data && typeof data.appBadge === 'number' ? data.appBadge : null;
  if (count === null || !('setAppBadge' in self.navigator)) {
    return;
  }
  event.waitUntil(
    (count > 0 ? self.navigator.setAppBadge(count) : self.navigator.clearAppBadge()).catch(() => undefined),
  );
});
