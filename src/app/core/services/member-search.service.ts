import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  QueryConstraint,
  QueryDocumentSnapshot,
  collection,
  getDocs,
  limit,
  query,
  startAfter,
  where,
} from '@angular/fire/firestore';
import type { Member, ProfileField, ProfileOptionValue } from '../models/firestore.models';

/** 正規の会員を、1回に読み込む人数(「もっと見る」で続きを読む)。 */
const PAGE_SIZE = 30;
/** 同じ連携コミュニティの、連携コミュニティだけのメンバーを読み込む上限。 */
const COMMUNITY_MEMBERS_MAX = 200;
/** array-contains-any に渡せる値の上限。 */
const MAX_COMMUNITY_IDS = 30;

export type MemberWithId = Member & { id: string };

export interface MemberSearchPage {
  /** 正規の会員(区分が member)。 */
  members: MemberWithId[];
  /** 続きを読むときに渡す。null なら続きは無い。 */
  cursor: QueryDocumentSnapshot | null;
}

/**
 * 会員検索。条件はテナントのプロフィール項目のうち「検索に使う」もの(member.profile[項目ID]、公開にした値だけが入る)。
 * 正規の会員は区分(membership == 'member')で絞り込んでページごとに読み、同じ連携コミュニティの
 * 連携コミュニティだけのメンバーは別に読む。並び順は会員のID順(条件が変わっても索引を追加しなくて済むように)。
 * 会員エリアのルート(member.routes.ts)で提供する(Firestore SDKを初回読み込みに含めないため)。
 */
@Injectable()
export class MemberSearchService {
  private readonly firestore = inject(Firestore);

  /** 正規の会員を、条件に合う人から1ページ分読む。cursor を渡すと続きを読む。 */
  async searchFullMembers(
    tenantId: string,
    field: ProfileField | null,
    value: string,
    cursor: QueryDocumentSnapshot | null = null,
  ): Promise<MemberSearchPage> {
    const constraints: QueryConstraint[] = [
      where('membership', '==', 'member'),
      where('isActive', '==', true),
      ...this.fieldConstraint(field, value),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(PAGE_SIZE),
    ];
    const snap = await getDocs(query(collection(this.firestore, `tenants/${tenantId}/members`), ...constraints));
    return {
      members: snap.docs.map((d) => ({ id: d.id, ...(d.data() as Member) })),
      cursor: snap.docs.length === PAGE_SIZE ? snap.docs[snap.docs.length - 1] : null,
    };
  }

  /**
   * 自分と同じ連携コミュニティに所属する、連携コミュニティだけのメンバー(区分が community)。
   * 連携コミュニティの条件だけで読み、区分・プロフィールの条件はここで絞る
   * (array-contains-any と、ほかの配列の条件は1つの検索に入れられないため)。
   */
  async searchCommunityMembers(
    tenantId: string,
    communityIds: string[],
    field: ProfileField | null,
    value: string,
  ): Promise<MemberWithId[]> {
    const ids = communityIds.slice(0, MAX_COMMUNITY_IDS);
    if (ids.length === 0) {
      return [];
    }
    const snap = await getDocs(
      query(
        collection(this.firestore, `tenants/${tenantId}/members`),
        where('communityIds', 'array-contains-any', ids),
        limit(COMMUNITY_MEMBERS_MAX),
      ),
    );
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Member) }))
      .filter((m) => m.membership === 'community' && m.isActive && this.matchesField(m, field, value));
  }

  /** 自由入力・複数入力の項目の、これまでの入力(入力候補)。 */
  async getProfileOptions(tenantId: string, fieldId: string): Promise<string[]> {
    const optionsRef = collection(this.firestore, `tenants/${tenantId}/profileOptions/${fieldId}/values`);
    const snap = await getDocs(optionsRef);
    return snap.docs.map((d) => (d.data() as ProfileOptionValue).label);
  }

  private fieldConstraint(field: ProfileField | null, value: string): QueryConstraint[] {
    return field && value ? [where(`profile.${field.id}`, field.type === 'tags' ? 'array-contains' : '==', value)] : [];
  }

  private matchesField(member: Member, field: ProfileField | null, value: string): boolean {
    if (!field || !value) {
      return true;
    }
    const current = member.profile?.[field.id];
    return Array.isArray(current) ? current.includes(value) : current === value;
  }
}
