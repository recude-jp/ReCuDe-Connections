import { Injectable, inject } from '@angular/core';
import { Firestore, collection, getDocs, limit, query, where } from '@angular/fire/firestore';
import type { Member, ProfileField, ProfileOptionValue } from '../models/firestore.models';

const MAX_RESULTS = 50;

/**
 * 会員検索。条件はテナントのプロフィール項目のうち「検索に使う」もの(member.profile[項目ID])。
 * 会員エリアのルート(member.routes.ts)で提供する(Firestore SDKを初回読み込みに含めないため)。
 */
@Injectable()
export class MemberSearchService {
  private readonly firestore = inject(Firestore);

  /** 項目が未指定の場合はテナント内の会員を(上限件数まで)そのまま返す。 */
  async searchMembers(tenantId: string, field: ProfileField | null, value: string): Promise<(Member & { id: string })[]> {
    const membersRef = collection(this.firestore, `tenants/${tenantId}/members`);
    const membersQuery =
      field && value
        ? query(
            membersRef,
            where(`profile.${field.id}`, field.type === 'tags' ? 'array-contains' : '==', value),
            limit(MAX_RESULTS),
          )
        : query(membersRef, limit(MAX_RESULTS));

    const snap = await getDocs(membersQuery);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Member) }));
  }

  /** 自由入力・複数入力の項目の、これまでの入力(入力候補)。 */
  async getProfileOptions(tenantId: string, fieldId: string): Promise<string[]> {
    const optionsRef = collection(this.firestore, `tenants/${tenantId}/profileOptions/${fieldId}/values`);
    const snap = await getDocs(optionsRef);
    return snap.docs.map((d) => (d.data() as ProfileOptionValue).label);
  }
}
