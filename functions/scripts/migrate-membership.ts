/**
 * 区分(membership)が無い会員に、正規の会員の区分('member')を書き入れるスクリプト(何度実行しても同じ結果になる)。
 * 区分が無いのは、ゲストの仕組みを入れる前からの正規の会員。出会いを探すは、区分が member の会員を
 * Firestore の条件で検索するため(区分の無い会員は条件に合わない)、先に書き入れておく。
 *
 * 実行:
 *   Emulator:  GCLOUD_PROJECT=demo-recude-match FIRESTORE_EMULATOR_HOST=localhost:8080 npm --prefix functions run migrate:membership
 *   実環境:    GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json GCLOUD_PROJECT=<プロジェクトID> npm --prefix functions run migrate:membership -- --yes
 */
import * as admin from 'firebase-admin';
import * as readline from 'readline';

const projectId = process.env.GCLOUD_PROJECT;
const useEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;

async function confirm(): Promise<void> {
  if (useEmulator || process.argv.includes('--yes')) {
    return;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) =>
    rl.question(`実環境(${projectId})の会員データに区分を書き入れます。よろしいですか？ (yes/no) `, resolve),
  );
  rl.close();
  if (answer.trim() !== 'yes') {
    console.log('中止しました。');
    process.exit(1);
  }
}

async function main(): Promise<void> {
  if (!projectId) {
    throw new Error('GCLOUD_PROJECT を指定してください。');
  }
  await confirm();
  admin.initializeApp({ projectId });
  const db = admin.firestore();

  const tenants = await db.collection('tenants').get();
  for (const tenantDoc of tenants.docs) {
    const members = await db.collection(`tenants/${tenantDoc.id}/members`).get();
    const missing = members.docs.filter((doc) => !doc.data()['membership']);
    for (let i = 0; i < missing.length; i += 400) {
      const batch = db.batch();
      missing.slice(i, i + 400).forEach((doc) => batch.update(doc.ref, { membership: 'member' }));
      await batch.commit();
    }
    console.log(`${tenantDoc.id}: 会員 ${members.size} 人のうち、${missing.length} 人に区分(member)を書き入れました。`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
