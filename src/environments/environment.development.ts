export const environment = {
  production: false,
  useEmulators: true,
  tenantId: 'gifu-tokyo',
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
