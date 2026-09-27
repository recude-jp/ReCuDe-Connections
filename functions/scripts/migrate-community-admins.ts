/**
 * 連携コミュニティの管理者(Community.adminIds)を、会員データの adminCommunityIds とカスタムクレームに反映する
 * (連携コミュニティの管理画面を入れる前に作った連携コミュニティのため。何度実行しても同じ結果になる)。
 *
 * Emulator: GCLOUD_PROJECT=demo-recude-match FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
 *   npm --prefix functions run migrate:community-admins
 * 本番: GOOGLE_APPLICATION_CREDENTIALS=... GCLOUD_PROJECT=<プロジェクトID> npm --prefix functions run migrate:community-admins -- --yes
 */
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { syncMemberClaims } from '../src/memberClaims';
import type { Community, Member } from '../src/models';

const isEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
if (!isEmulator && !process.argv.includes('--yes')) {
  console.error('本番に実行するときは --yes を付けてください。');
  process.exit(1);
}
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

(async () => {
  for (const tenant of (await db.collection('tenants').get()).docs) {
    const communities = (await tenant.ref.collection('communities').get()).docs;
    const expected = new Map<string, string[]>();
    for (const doc of communities) {
      for (const id of (doc.data() as Community).adminIds) {
        expected.set(id, [...(expected.get(id) ?? []), doc.id]);
      }
    }
    for (const doc of (await tenant.ref.collection('members').get()).docs) {
      const member = doc.data() as Member;
      const want = (expected.get(doc.id) ?? []).sort();
      const have = [...(member.adminCommunityIds ?? [])].sort();
      if (JSON.stringify(want) === JSON.stringify(have)) {
        continue;
      }
      await doc.ref.update({
        adminCommunityIds: want,
        ...(want.length ? { communityIds: FieldValue.arrayUnion(...want) } : {}),
      });
      const updated = (await doc.ref.get()).data() as Member;
      await syncMemberClaims(tenant.id, doc.id, updated);
      console.log(`${tenant.id}/${doc.id} ${member.displayName}: adminCommunityIds = [${want.join(', ')}]`);
    }
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
