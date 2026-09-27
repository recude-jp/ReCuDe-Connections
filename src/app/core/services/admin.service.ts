import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore, collection, collectionData, doc, docData } from '@angular/fire/firestore';
import { Storage, getDownloadURL, ref, uploadBytes } from '@angular/fire/storage';
import { Observable, map } from 'rxjs';
import type { CommunityScope, Member, MembershipTermsFormat, ProfileField, StampPackScope } from '../models/firestore.models';
import type { PreparedStamp } from '../utils/image';
import { communityStampImagePath } from './community-stamp.service';

export type MemberRow = Member & { id: string };

export interface CommunityInput {
  name: string;
  description: string;
  /** 省くと管理者は変えない(サービス設定から名称・ロゴ・説明だけを変えるとき)。 */
  adminIds?: string[];
  logoUrl?: string | null;
  /** ロゴが無いときに出す文字(2文字まで)。空文字で未設定に戻す。 */
  logoText?: string;
}

/**
 * 管理画面(/admin)の会員管理。書き込みはすべてCloud Functions経由(カスタムクレームの更新を伴うため)。
 * 管理画面のルート(member.routes.ts)で提供する。
 */
@Injectable()
export class AdminService {
  private readonly functions = inject(Functions);
  private readonly firestore = inject(Firestore);
  private readonly storage = inject(Storage);

  /** テナントの全会員。並べ替え・絞り込みは件数が少ない前提で画面側で行う。 */
  listMembers(tenantId: string): Observable<MemberRow[]> {
    const ref = collection(this.firestore, `tenants/${tenantId}/members`);
    return collectionData(ref, { idField: 'id' }) as Observable<MemberRow[]>;
  }

  getMember(tenantId: string, memberId: string): Observable<MemberRow | undefined> {
    const ref = doc(this.firestore, `tenants/${tenantId}/members/${memberId}`);
    return (docData(ref) as Observable<Member | undefined>).pipe(
      map((member) => (member ? { ...member, id: memberId } : undefined)),
    );
  }

  async setRoles(memberId: string, roles: { recommender?: boolean; admin?: boolean }): Promise<void> {
    const fn = httpsCallable<{ memberId: string; recommender?: boolean; admin?: boolean }, unknown>(
      this.functions,
      'setMemberRoles',
    );
    await fn({ memberId, ...roles });
  }

  /** 対象のコミュニティのプロフィール項目を一覧ごと置き換える(並び順も一覧の順)。 */
  async updateProfileFields(scope: CommunityScope, fields: ProfileField[]): Promise<void> {
    const fn = httpsCallable<{ scope: CommunityScope; fields: ProfileField[] }, unknown>(this.functions, 'updateProfileFields');
    await fn({ scope, fields });
  }

  /**
   * 対象のコミュニティの会員条件(連携コミュニティは参加の条件)を設定する(本文が空なら外す)。
   * requireApproval は連携コミュニティだけ(参加に管理者の承認を必要とするか)。
   */
  async updateMembershipTerms(
    scope: CommunityScope,
    input: { format: MembershipTermsFormat; body: string; requireAgreement: boolean; requireApproval?: boolean },
  ): Promise<void> {
    const fn = httpsCallable<typeof input & { scope: CommunityScope }, unknown>(this.functions, 'updateMembershipTerms');
    await fn({ ...input, scope });
  }

  /** 連携コミュニティの管理者に任命する・外す。 */
  async setCommunityAdmin(communityId: string, memberId: string, admin: boolean): Promise<void> {
    const fn = httpsCallable<{ communityId: string; memberId: string; admin: boolean }, unknown>(
      this.functions,
      'setCommunityAdmin',
    );
    await fn({ communityId, memberId, admin });
  }

  /** メンバーを連携コミュニティから外す。 */
  async removeCommunityMember(communityId: string, memberId: string): Promise<void> {
    const fn = httpsCallable<{ communityId: string; memberId: string }, unknown>(this.functions, 'removeCommunityMember');
    await fn({ communityId, memberId });
  }

  /** 連携コミュニティへの参加の申請を承認・否認する。 */
  async decideCommunityApplication(communityId: string, memberId: string, approve: boolean, reason = ''): Promise<void> {
    const fn = httpsCallable<{ communityId: string; memberId: string; approve: boolean; reason: string }, unknown>(
      this.functions,
      'decideCommunityApplication',
    );
    await fn({ communityId, memberId, approve, reason });
  }

  /** ゲストの会員申請を承認・否認する(承認すると正規の会員になる)。 */
  async decideMembership(memberId: string, approve: boolean, reason = ''): Promise<void> {
    const fn = httpsCallable<{ memberId: string; approve: boolean; reason: string }, unknown>(
      this.functions,
      'decideMembership',
    );
    await fn({ memberId, approve, reason });
  }

  /** 連携コミュニティを追加する(管理者はルートコミュニティの会員から1人以上)。 */
  async createCommunity(input: CommunityInput & { adminIds: string[] }): Promise<string> {
    const fn = httpsCallable<CommunityInput, { communityId: string }>(this.functions, 'createCommunity');
    return (await fn(input)).data.communityId;
  }

  /** 連携コミュニティの名称・説明・ロゴ・管理者を変える。logoUrl: undefined は変えない、null は外す。 */
  async updateCommunity(communityId: string, input: CommunityInput): Promise<void> {
    const fn = httpsCallable<CommunityInput & { communityId: string }, unknown>(this.functions, 'updateCommunity');
    await fn({ ...input, communityId });
  }

  /** 連携コミュニティを削除する(確認のため名称を送る)。 */
  async deleteCommunity(communityId: string, confirmName: string): Promise<void> {
    const fn = httpsCallable<{ communityId: string; confirmName: string }, unknown>(this.functions, 'deleteCommunity');
    await fn({ communityId, confirmName });
  }

  /** 連携コミュニティのロゴを上げ、表示用のURLを返す(同じパスに上書きするため、更新時刻を付けてキャッシュを避ける)。 */
  async uploadCommunityLogo(tenantId: string, communityId: string, file: File): Promise<string> {
    const fileRef = ref(this.storage, `tenants/${tenantId}/communities/${communityId}/logo`);
    await uploadBytes(fileRef, file, { contentType: file.type });
    return `${await getDownloadURL(fileRef)}&v=${Date.now()}`;
  }

  /** コミュニティのスタンプのパックを作る(最初は非表示)。 */
  async createStampPack(name: string, scope: StampPackScope): Promise<string> {
    const fn = httpsCallable<{ name: string; scope: StampPackScope }, { packId: string }>(this.functions, 'createStampPack');
    return (await fn({ name, scope })).data.packId;
  }

  /** スタンプの画像を上げてから、パックに加える(一覧にあるのに画像が無い、という状態を作らないため)。 */
  async addCommunityStamp(tenantId: string, packId: string, stamp: PreparedStamp, text: string): Promise<void> {
    // スタンプのIDは Firestore の自動IDと同じ形(20文字の英数字)にする。
    const stampId = doc(collection(this.firestore, '_')).id;
    await uploadBytes(ref(this.storage, communityStampImagePath(tenantId, packId, stampId)), stamp.blob, {
      contentType: stamp.contentType,
      // 同じパスは上書きしない(storage.rules)ため、長期間キャッシュしてよい。
      cacheControl: 'public, max-age=31536000, immutable',
    });
    const fn = httpsCallable<{ packId: string; stampId: string; text: string }, unknown>(this.functions, 'addCommunityStamp');
    await fn({ packId, stampId, text });
  }

  /** パックの名前・公開状態と、スタンプの並び順・文言・公開状態を保存する(stamps は並べたい順に全部)。 */
  async updateStampPack(
    packId: string,
    input: { name: string; hidden: boolean; stamps: { id: string; text: string; hidden: boolean }[] },
  ): Promise<void> {
    const fn = httpsCallable<typeof input & { packId: string }, unknown>(this.functions, 'updateStampPack');
    await fn({ ...input, packId });
  }

  async setStatus(memberId: string, active: boolean): Promise<void> {
    const fn = httpsCallable<{ memberId: string; active: boolean }, unknown>(this.functions, 'setMemberStatus');
    await fn({ memberId, active });
  }
}
