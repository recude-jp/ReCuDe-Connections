import { Injectable, inject } from '@angular/core';
import { Firestore, collection, collectionData, doc, docData } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Storage, getDownloadURL, ref, uploadBytes } from '@angular/fire/storage';
import { Observable, map } from 'rxjs';
import type {
  Community,
  Member,
  MemberLoginSettings,
  MemberPrivateProfile,
  ProfileValues,
  ProfileVisibility,
  Tenant,
} from '../models/firestore.models';

/** 会員エリアのルート(member.routes.ts)で提供する(Firestore SDKを初回読み込みに含めないため)。 */
/** 連携コミュニティ(IDつき)。 */
export type CommunityRow = Community & { id: string };

@Injectable()
export class MemberService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);
  private readonly storage = inject(Storage);

  /** プロフィール画像のダウンロードURLのキャッシュ。 */
  private readonly photoUrls = new Map<string, Promise<string>>();

  getTenant(tenantId: string): Observable<Tenant | undefined> {
    const ref = doc(this.firestore, `tenants/${tenantId}`);
    return docData(ref) as Observable<Tenant | undefined>;
  }

  /** テナントの連携コミュニティ(SPEC 9章)。名称・ロゴの表示に使う。 */
  listCommunities(tenantId: string): Observable<CommunityRow[]> {
    const ref = collection(this.firestore, `tenants/${tenantId}/communities`);
    return collectionData(ref, { idField: 'id' }) as Observable<CommunityRow[]>;
  }

  /** 所属する連携コミュニティ独自のプロフィール項目を保存する(本人だけ)。 */
  async updateCommunityProfile(communityId: string, profile: ProfileValues): Promise<void> {
    const fn = httpsCallable<{ communityId: string; profile: ProfileValues }, unknown>(this.functions, 'updateCommunityProfile');
    await fn({ communityId, profile });
  }

  /** 非公開のプロフィールの値(生年月など)。読めるのは本人と管理者だけ(firestore.rules)。 */
  getPrivateProfile(tenantId: string, memberId: string): Observable<ProfileValues> {
    return this.getPrivateProfileDoc(tenantId, memberId).pipe(map((data) => data.values));
  }

  /** private/profile(すべての値と、本人が選んだ公開範囲)。読めるのは本人と管理者だけ。 */
  getPrivateProfileDoc(
    tenantId: string,
    memberId: string,
  ): Observable<{ values: ProfileValues; visibility: Record<string, ProfileVisibility> }> {
    const ref = doc(this.firestore, `tenants/${tenantId}/members/${memberId}/private/profile`);
    return (docData(ref) as Observable<MemberPrivateProfile | undefined>).pipe(
      map((data) => ({ values: data?.values ?? {}, visibility: data?.visibility ?? {} })),
    );
  }

  /** private/login(電話番号・ログインID・メールアドレス)。読めるのは本人と管理者だけ。 */
  getLoginSettingsDoc(tenantId: string, memberId: string): Observable<MemberLoginSettings | undefined> {
    const ref = doc(this.firestore, `tenants/${tenantId}/members/${memberId}/private/login`);
    return docData(ref) as Observable<MemberLoginSettings | undefined>;
  }

  getMember(tenantId: string, memberId: string): Observable<Member | undefined> {
    const ref = doc(this.firestore, `tenants/${tenantId}/members/${memberId}`);
    return docData(ref) as Observable<Member | undefined>;
  }

  /**
   * 自分のプロフィールを更新する(会員ドキュメントは直接書けないため Cloud Functions 経由)。
   * photoPath: 新しく上げた画像のパス、null で画像を外す、undefined で変えない。
   */
  /** avatarText: 写真が無いときに丸いアイコンに出す文字(2文字まで。空文字で未設定に戻す。省くと変えない)。 */
  async updateMyProfile(
    displayName: string,
    profile: ProfileValues,
    photoPath?: string | null,
    avatarText?: string,
    visibility?: Record<string, ProfileVisibility>,
  ): Promise<void> {
    const fn = httpsCallable<
      {
        displayName: string;
        profile: ProfileValues;
        photoPath?: string | null;
        avatarText?: string;
        visibility?: Record<string, ProfileVisibility>;
      },
      unknown
    >(this.functions, 'updateMyProfile');
    await fn({
      displayName,
      profile,
      ...(photoPath !== undefined ? { photoPath } : {}),
      ...(avatarText !== undefined ? { avatarText } : {}),
      ...(visibility ? { visibility } : {}),
    });
  }

  /** プロフィール画像を上げて、そのパスを返す(差し替えるたびに別の名前にする。キャッシュに古い画像が残らないように)。 */
  async uploadPhoto(tenantId: string, memberId: string, blob: Blob): Promise<string> {
    const path = `tenants/${tenantId}/members/${memberId}/photo/${Date.now()}.jpg`;
    await uploadBytes(ref(this.storage, path), blob, {
      contentType: 'image/jpeg',
      cacheControl: 'private, max-age=31536000',
    });
    return path;
  }

  getPhotoUrl(path: string): Promise<string> {
    let url = this.photoUrls.get(path);
    if (!url) {
      url = getDownloadURL(ref(this.storage, path));
      url.catch(() => this.photoUrls.delete(path));
      this.photoUrls.set(path, url);
    }
    return url;
  }

  /** ゲストが正規の会員を申請する(テナントのプロフィール項目を入力し、会員条件に同意して)。審査は管理者が行う。 */
  async applyForMembership(
    profile: ProfileValues,
    agreedToTerms: boolean,
    visibility: Record<string, ProfileVisibility>,
  ): Promise<void> {
    const fn = httpsCallable<
      { profile: ProfileValues; agreedToTerms: boolean; visibility: Record<string, ProfileVisibility> },
      unknown
    >(this.functions, 'applyForMembership');
    await fn({ profile, agreedToTerms, visibility });
  }
}
