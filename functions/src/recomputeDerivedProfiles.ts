import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { recomputeCommunityDerivedValues, recomputeDerivedValues } from './profile';
import type { Community } from './models';

/**
 * 毎月1日(日本時間)に、全テナント(と連携コミュニティ)の自動計算のプロフィール項目を計算し直す。
 * 例: 生年月から年代を決める項目は、生年月の翌月から年代が上がるため、月が変わったら反映する。
 * 保存したとき・項目の設定を変えたときにも計算するので、これは月の切り替わりのための定期実行。
 */
export const recomputeDerivedProfiles = onSchedule(
  { schedule: '5 0 1 * *', timeZone: 'Asia/Tokyo' },
  async () => {
    const tenants = await admin.firestore().collection('tenants').get();
    for (const tenant of tenants.docs) {
      const changed = await recomputeDerivedValues(tenant.id);
      logger.info(`recomputeDerivedProfiles: ${tenant.id} で ${changed}人の自動計算の項目を更新しました。`);
      // 連携コミュニティ独自の項目も計算し直す。
      const communities = await tenant.ref.collection('communities').get();
      for (const community of communities.docs) {
        const fields = (community.data() as Community).profileFields ?? [];
        const count = await recomputeCommunityDerivedValues(tenant.id, community.id, fields);
        if (count > 0) {
          logger.info(`recomputeDerivedProfiles: ${tenant.id}/${community.id} で ${count}人を更新しました。`);
        }
      }
    }
  },
);
