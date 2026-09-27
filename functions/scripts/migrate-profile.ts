/**
 * プロフィールを「テナントごとのプロフィール項目」方式へ移行するスクリプト(何度実行しても同じ結果になる)。
 *   - 会員の旧項目(hometown・highSchool・juniorHighSchool・club・hobbies・ageGroup)を member.profile に移して、旧項目を消す
 *     (趣味は項目ID hobby。入力候補 profileOptions/hobby をそのまま使うため)
 *   - 招待の candidateProfile も同じ形に直す
 *   - テナントにプロフィール項目(profileFields)が無く、旧項目の値がある場合は、旧項目と同じ6項目を作る
 *
 * 実行:
 *   Emulator:  GCLOUD_PROJECT=demo-recude-match FIRESTORE_EMULATOR_HOST=localhost:8080 npm --prefix functions run migrate:profile
 *   実環境:    GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json GCLOUD_PROJECT=<プロジェクトID> npm --prefix functions run migrate:profile -- --yes
 */
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import type { ProfileField, ProfileValues } from '../src/models';

const projectId = process.env.GCLOUD_PROJECT;
const useEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;

/** 旧項目 → 新しいプロフィール項目。 */
const LEGACY_FIELDS: { legacyKey: string; field: ProfileField }[] = [
  { legacyKey: 'hometown', field: { id: 'hometown', label: '出身地', type: 'text', searchable: true } },
  { legacyKey: 'highSchool', field: { id: 'highSchool', label: '出身高校', type: 'text', searchable: true } },
  { legacyKey: 'juniorHighSchool', field: { id: 'juniorHighSchool', label: '出身中学', type: 'text', searchable: true } },
  { legacyKey: 'club', field: { id: 'club', label: '部活動', type: 'text', searchable: true } },
  { legacyKey: 'hobbies', field: { id: 'hobby', label: '趣味', type: 'tags', searchable: true } },
  {
    legacyKey: 'ageGroup',
    field: { id: 'ageGroup', label: '年代', type: 'select', options: ['20代', '30代', '40代', '50代', '60代以上'] },
  },
];

/** 旧項目の値を新しい形(項目ID → 値)に直す。旧項目が無ければ null。 */
function toProfile(data: Record<string, unknown>): ProfileValues | null {
  const profile: ProfileValues = {};
  let found = false;
  for (const { legacyKey, field } of LEGACY_FIELDS) {
    if (!(legacyKey in data)) {
      continue;
    }
    found = true;
    const value = data[legacyKey];
    if (Array.isArray(value) && value.length > 0) {
      profile[field.id] = value.map(String);
    } else if (typeof value === 'string' && value.trim()) {
      profile[field.id] = value.trim();
    }
  }
  return found ? profile : null;
}

async function confirm(): Promise<void> {
  if (useEmulator || process.argv.includes('--yes')) {
    return;
  }
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`実環境 ${projectId} のプロフィールを新しい形に移行します。続行しますか？ [y/N] `);
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.log('中断しました。');
    process.exit(1);
  }
}

async function main(): Promise<void> {
  if (!projectId) {
    console.error('エラー: GCLOUD_PROJECT を指定してください。');
    process.exit(1);
  }
  if (!useEmulator && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('エラー: 実環境では GOOGLE_APPLICATION_CREDENTIALS を指定してください（Emulatorなら FIRESTORE_EMULATOR_HOST）。');
    process.exit(1);
  }
  await confirm();

  admin.initializeApp({ projectId });
  const db = admin.firestore();
  const deleteLegacy = Object.fromEntries(LEGACY_FIELDS.map(({ legacyKey }) => [legacyKey, FieldValue.delete()]));

  for (const tenant of (await db.collection('tenants').get()).docs) {
    let migratedMembers = 0;
    let migratedInvites = 0;
    let hasLegacyValues = false;

    for (const memberDoc of (await tenant.ref.collection('members').get()).docs) {
      const data = memberDoc.data();
      const legacy = toProfile(data);
      if (!legacy) {
        continue;
      }
      hasLegacyValues = true;
      // 既に profile がある場合は、そちらを優先する(移行後に会員が編集した値を上書きしない)。
      await memberDoc.ref.update({ profile: { ...legacy, ...(data['profile'] ?? {}) }, ...deleteLegacy });
      migratedMembers++;
    }

    for (const inviteDoc of (await tenant.ref.collection('invites').get()).docs) {
      const candidate = inviteDoc.data()['candidateProfile'] as Record<string, unknown> | undefined;
      const legacy = candidate ? toProfile(candidate) : null;
      if (!candidate || !legacy) {
        continue;
      }
      hasLegacyValues = true;
      await inviteDoc.ref.update({
        candidateProfile: { displayName: candidate['displayName'] ?? '', profile: { ...legacy, ...((candidate['profile'] as object) ?? {}) } },
      });
      migratedInvites++;
    }

    let createdFields = false;
    if (!tenant.data()['profileFields'] && hasLegacyValues) {
      await tenant.ref.update({ profileFields: LEGACY_FIELDS.map(({ field }) => field) });
      createdFields = true;
    }

    console.log(
      `${tenant.id}: 会員 ${migratedMembers}人・招待 ${migratedInvites}件を移行しました。` +
        (createdFields ? 'プロフィール項目（旧項目と同じ6項目）を作りました。' : ''),
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
