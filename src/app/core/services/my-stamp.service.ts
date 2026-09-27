import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  deleteDoc,
  doc,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from '@angular/fire/firestore';
import { Storage, deleteObject, getDownloadURL, ref, uploadBytes } from '@angular/fire/storage';
import { Observable } from 'rxjs';
import type { MyStamp } from '../models/firestore.models';
import type { PreparedStamp } from '../utils/image';

/** 1人が登録できるマイスタンプの数。 */
export const MY_STAMP_LIMIT = 24;

/**
 * マイスタンプ(会員が自分で登録したスタンプ)。一覧は Firestore の members/[memberId]/stamps、
 * 画像は Storage の tenants/[tenantId]/members/[memberId]/stamps/[stampId]。
 * 会員エリアのルート(member.routes.ts)で提供する。
 */
@Injectable()
export class MyStampService {
  private readonly firestore = inject(Firestore);
  private readonly storage = inject(Storage);

  /** 画像のダウンロードURLのキャッシュ(同じスタンプを何度も問い合わせないため)。 */
  private readonly urls = new Map<string, Promise<string>>();

  private storagePath(tenantId: string, ownerId: string, stampId: string): string {
    return `tenants/${tenantId}/members/${ownerId}/stamps/${stampId}`;
  }

  /** 自分のマイスタンプ(登録順)。 */
  listMine(tenantId: string, memberId: string): Observable<(MyStamp & { id: string })[]> {
    const col = collection(this.firestore, `tenants/${tenantId}/members/${memberId}/stamps`);
    return collectionData(query(col, orderBy('createdAt', 'asc')), { idField: 'id' }) as Observable<
      (MyStamp & { id: string })[]
    >;
  }

  /** 画像を上げてから一覧に登録する(一覧にあるのに画像が無い、という状態を作らないため)。 */
  async add(tenantId: string, memberId: string, stamp: PreparedStamp, text: string): Promise<void> {
    const stampRef = doc(collection(this.firestore, `tenants/${tenantId}/members/${memberId}/stamps`));
    await uploadBytes(ref(this.storage, this.storagePath(tenantId, memberId, stampRef.id)), stamp.blob, {
      contentType: stamp.contentType,
      // 同じパスは上書きしない(storage.rules)ため、長期間キャッシュしてよい。
      cacheControl: 'private, max-age=31536000',
    });
    await setDoc(stampRef, { text, contentType: stamp.contentType, createdAt: serverTimestamp() });
  }

  /** 一覧から外してから画像を消す。過去のメッセージのこのスタンプは「削除されたスタンプ」と表示される。 */
  async remove(tenantId: string, memberId: string, stampId: string): Promise<void> {
    await deleteDoc(doc(this.firestore, `tenants/${tenantId}/members/${memberId}/stamps/${stampId}`));
    const path = this.storagePath(tenantId, memberId, stampId);
    this.urls.delete(path);
    await deleteObject(ref(this.storage, path)).catch(() => undefined);
  }

  /** マイスタンプの画像のURL(同じテナントの会員なら誰でも取得できる)。 */
  getImageUrl(tenantId: string, ownerId: string, stampId: string): Promise<string> {
    const path = this.storagePath(tenantId, ownerId, stampId);
    let url = this.urls.get(path);
    if (!url) {
      url = getDownloadURL(ref(this.storage, path));
      url.catch(() => this.urls.delete(path));
      this.urls.set(path, url);
    }
    return url;
  }
}
