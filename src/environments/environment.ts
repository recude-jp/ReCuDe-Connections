export const environment = {
  production: true,
  useEmulators: false,
  tenantId: 'tokyo-gifu-connect',
  /** プッシュ通知(Web Push)の VAPID 公開鍵。functions/src/push.ts の VAPID_PUBLIC_KEY と同じ値。 */
  vapidPublicKey: 'BEd8ac3Ev9Gae7c7B1ynSGjZOrfCTImzA7XwHVDTkeCTKfZugkvBmjn6z3JIkEgQT_2xGUeO6Ganrt1UscTwW7Q',
  firebase: {
    // 本番Firebaseプロジェクト作成後、Firebase Console > プロジェクトの設定 から取得した値に置き換える。
    apiKey: 'AIzaSyCKC2ZH6-wTZUufbRAZV5bwriiuba_N6aU',
    authDomain: 'default-41833.firebaseapp.com',
    projectId: 'default-41833',
    storageBucket: 'default-41833.firebasestorage.app',
    messagingSenderId: '590055729282',
    appId: '1:590055729282:web:abdabc029cd247eeb5ac9b',
  },
};
