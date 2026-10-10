/**
 * 個人情報の公開の設計(SECURITY-DEVELOPMENT.md 7章)へ移行するスクリプト(何度実行しても同じ結果になる)。
 *   - 会員データの電話番号(phoneNumber)を private/login に移して、会員データからは消す
 *   - プロフィールの値をすべて private/profile に集め、会員データの profile を空にする
 *     (公開・非公開は初期は未設定で、未設定は非公開。会員が自分で項目ごとに設定する)
 *   - すでに公開範囲を設定した会員(private/profile に visibility がある)は、その設定に従って profile を作り直す
 *
 * 実行:
 *   Emulator:  GCLOUD_PROJECT=demo-recude-match FIRESTORE_EMULATOR_HOST=localhost:8080 npm --prefix functions run migrate:privacy
 *   実環境:    GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json GCLOUD_PROJECT=<プロジェクトID> npm --prefix functions run migrate:privacy -- --yes
 */
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as readline from 'readline';
import type { Member, MemberPrivateProfile, ProfileField, Tenant } from '../src/models';
import { splitProfileValues } from '../src/profile';

const projectId = process.env.GCLOUD_PROJECT;
const useEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;

async function confirm(): Promise<void> {
  if (useEmulator || process.argv.includes('--yes')) {
    return;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) =>
    rl.question(`実環境(${projectId})の会員データを移行します。よろしいですか？ (yes/no) `, resolve),
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
    const fields: ProfileField[] = (tenantDoc.data() as Tenant).profileFields ?? [];
    const members = await db.collection(`tenants/${tenantDoc.id}/members`).get();
    let movedPhones = 0;
    let movedProfiles = 0;
    for (const memberDoc of members.docs) {
      const member = memberDoc.data() as Member;
      const privateRef = memberDoc.ref.collection('private').doc('profile');
      const loginRef = memberDoc.ref.collection('private').doc('login');
      const stored = (await privateRef.get()).data() as MemberPrivateProfile | undefined;
      const visibility = stored?.visibility ?? {};
      const allValues = { ...(member.profile ?? {}), ...(stored?.values ?? {}) };
      const { publicValues, privateValues } = splitProfileValues(fields, allValues, visibility);

      const batch = db.batch();
      if (member.phoneNumber) {
        batch.set(loginRef, { phoneNumber: member.phoneNumber, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        batch.update(memberDoc.ref, { phoneNumber: FieldValue.delete() });
        movedPhones++;
      }
      const profileChanged = JSON.stringify(publicValues) !== JSON.stringify(member.profile ?? {});
      const privateChanged = JSON.stringify(privateValues) !== JSON.stringify(stored?.values ?? {});
      if (profileChanged || privateChanged) {
        batch.update(memberDoc.ref, { profile: publicValues });
        batch.set(privateRef, { values: privateValues, visibility, updatedAt: FieldValue.serverTimestamp() });
        movedProfiles++;
      }
      await batch.commit();
    }
    console.log(`${tenantDoc.id}: 会員${members.size}人のうち、電話番号を移した人 ${movedPhones}人、プロフィールを移した人 ${movedProfiles}人`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
