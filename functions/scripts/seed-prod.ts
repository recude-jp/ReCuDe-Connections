/**
 * 実際のFirebaseプロジェクト（GCP）でテナントをセットアップするスクリプト。
 * 1回の実行で、テナント（組織名・サービス名）と最初の管理者ユーザーを作る。
 * 管理者は「会員＋管理者ロール」のため、会員として作成し roles.admin と roles.recommender を付ける。
 * 管理者は一般会員と同じく電話番号（SMS）・パスキー・PINでログインする。
 *
 * ローカルEmulator専用の scripts/seed.ts とは別物で、Emulatorホストの環境変数は一切設定しない
 * （＝Admin SDKは実プロジェクトに接続する）。誤って適当な値で本番データを作らないよう、
 * 必要な値はすべて環境変数で明示的に渡す必要がある。
 *
 * 同じ電話番号で再実行した場合は、既存の会員に管理者ロールを付け直す（会員を重複して作らない）。
 *
 * 実行前提:
 *   - GOOGLE_APPLICATION_CREDENTIALS に、対象プロジェクトのサービスアカウントキー(JSON)のパスを設定していること
 *     （Firebase Console > プロジェクトの設定 > サービスアカウント からダウンロード）
 *
 * 実行例:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
 *   GCLOUD_PROJECT=your-project-id \
 *   SEED_TENANT_ID=gifu-tokyo \
 *   SEED_TENANT_NAME="東京岐阜県人会" \
 *   SEED_SERVICE_NAME="TOKYO GIFU CONNECT" \
 *   SEED_ADMIN_PHONE=+819000000000 \
 *   SEED_ADMIN_NAME="山田太郎" \
 *   npm --prefix functions run seed:prod -- --yes
 */
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

interface SetupConfig {
  projectId: string;
  tenantId: string;
  tenantName: string;
  serviceName: string;
  adminPhone: string;
  adminName: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`エラー: 環境変数 ${name} が未設定です。`);
    printUsageAndExit();
  }
  return value as string;
}

function printUsageAndExit(): never {
  console.error('');
  console.error('必要な環境変数:');
  console.error('  GOOGLE_APPLICATION_CREDENTIALS  サービスアカウントキー(JSON)のパス');
  console.error('  GCLOUD_PROJECT                  対象のFirebaseプロジェクトID');
  console.error('  SEED_TENANT_ID                  テナントID（例: gifu-tokyo）');
  console.error('  SEED_TENANT_NAME                組織名（例: 東京岐阜県人会）');
  console.error('  SEED_SERVICE_NAME               サービス名（任意。例: TOKYO GIFU CONNECT。省略時は組織名）');
  console.error('  SEED_ADMIN_PHONE                最初の管理者の電話番号(E.164形式)');
  console.error('  SEED_ADMIN_NAME                 最初の管理者の表示名');
  console.error('');
  console.error('確認なしで実行するには末尾に -- --yes を付けてください。');
  process.exit(1);
}

function loadConfig(): SetupConfig {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('エラー: GOOGLE_APPLICATION_CREDENTIALS が未設定です（サービスアカウントキーのパス）。');
    printUsageAndExit();
  }

  const tenantName = requireEnv('SEED_TENANT_NAME');
  const adminPhone = requireEnv('SEED_ADMIN_PHONE');
  if (!/^\+\d{8,15}$/.test(adminPhone)) {
    console.error('エラー: SEED_ADMIN_PHONE はE.164形式（例: +819012345678）で指定してください。');
    printUsageAndExit();
  }

  return {
    projectId: requireEnv('GCLOUD_PROJECT'),
    tenantId: requireEnv('SEED_TENANT_ID'),
    tenantName,
    serviceName: process.env.SEED_SERVICE_NAME || tenantName,
    adminPhone,
    adminName: requireEnv('SEED_ADMIN_NAME'),
  };
}

async function confirm(config: SetupConfig): Promise<void> {
  if (process.argv.includes('--yes')) {
    return;
  }
  console.log(`対象プロジェクト: ${config.projectId} でテナントをセットアップします。`);
  console.log(`  テナント: ${config.tenantId}（組織名: ${config.tenantName} / サービス名: ${config.serviceName}）`);
  console.log(`  最初の管理者: ${config.adminName} (${config.adminPhone})`);
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('続行しますか？ [y/N] ');
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.log('中断しました。');
    process.exit(1);
  }
}

async function setup(config: SetupConfig): Promise<void> {
  admin.initializeApp({ projectId: config.projectId });
  const db = admin.firestore();

  const tenantRef = db.doc(`tenants/${config.tenantId}`);
  const tenantSnap = await tenantRef.get();
  await tenantRef.set(
    {
      name: config.tenantName,
      isActive: true,
      // 再実行時は、管理画面で変更されたサービス名(SEED_SERVICE_NAMEを明示した場合を除く)・作成日時・都道府県を上書きしない。
      ...(!tenantSnap.exists || process.env.SEED_SERVICE_NAME ? { branding: { siteTitle: config.serviceName } } : {}),
      ...(tenantSnap.exists ? {} : { prefecture: '', createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true },
  );

  // 電話番号が既に会員登録済みなら、その会員に管理者ロールを付ける。
  const phoneIndexRef = db.doc(`phoneIndex/${config.adminPhone}`);
  const phoneIndexSnap = await phoneIndexRef.get();
  let memberId: string;
  if (phoneIndexSnap.exists) {
    const entry = phoneIndexSnap.data() as { tenantId: string; memberId: string };
    if (entry.tenantId !== config.tenantId) {
      throw new Error(`この電話番号は別のテナント（${entry.tenantId}）の会員として登録済みです。`);
    }
    memberId = entry.memberId;
    await db.doc(`tenants/${config.tenantId}/members/${memberId}`).update({
      'roles.admin': true,
      'roles.recommender': true,
      isActive: true,
    });
    console.log(`既存の会員（${memberId}）に管理者ロールを付けました。`);
  } else {
    memberId = `member-${Date.now()}`;
    await db.doc(`tenants/${config.tenantId}/members/${memberId}`).set({
      phoneNumber: config.adminPhone,
      displayName: config.adminName,
      roles: { recommender: true, admin: true },
      isActive: true,
      invitedBy: null,
      createdAt: FieldValue.serverTimestamp(),
    });
    await phoneIndexRef.set({ tenantId: config.tenantId, memberId });
    console.log(`管理者の会員（${memberId}）を作成しました。`);
  }

  // 既にログインしたことがある場合は、カスタムクレームにも管理者ロールを反映する(次回ログイン時にも設定される)。
  try {
    const user = await admin.auth().getUserByPhoneNumber(config.adminPhone);
    await admin.auth().setCustomUserClaims(user.uid, {
      tenantId: config.tenantId,
      memberId,
      isRecommender: true,
      isAdmin: true,
    });
  } catch (err) {
    if ((err as { code?: string }).code !== 'auth/user-not-found') {
      throw err;
    }
  }

  console.log('');
  console.log('セットアップ完了。');
  console.log(`  管理者のログイン用電話番号: ${config.adminPhone}`);
  console.log(
    '  実SMSは送らない前提のため、Firebase Console > Authentication > Sign-in method の' +
      '「テスト用の電話番号」にこの番号と固定OTPコードを登録しておくこと。',
  );
  console.log('  ログイン後、メニューバーの「管理」から管理画面に入れる。');
}

async function main(): Promise<void> {
  const config = loadConfig();
  await confirm(config);
  await setup(config);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
