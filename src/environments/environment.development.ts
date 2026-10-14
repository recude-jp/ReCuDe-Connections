export const environment = {
  production: false,
  useEmulators: true,
  tenantId: 'gifu-tokyo',
  /** プッシュ通知(Web Push)の VAPID 公開鍵。functions/src/push.ts の VAPID_PUBLIC_KEY と同じ値。 */
  vapidPublicKey: 'BEd8ac3Ev9Gae7c7B1ynSGjZOrfCTImzA7XwHVDTkeCTKfZugkvBmjn6z3JIkEgQT_2xGUeO6Ganrt1UscTwW7Q',
  firebase: {
    // Firebase Local Emulator Suiteに接続するため、projectIdのみ .firebaserc と一致していれば
    // 実際の値でなくてよい(エミュレータは認証情報を検証しない)。
    apiKey: 'demo-api-key',
    authDomain: 'localhost',
    projectId: 'demo-recude-match',
    storageBucket: 'demo-recude-match.appspot.com',
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:0000000000000000000000',
  },
};
