import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
  FieldPath,
  Firestore,
  addDoc,
  collection,
  collectionData,
  deleteField,
  doc,
  docData,
  limitToLast,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { Storage, getDownloadURL, ref, uploadBytesResumable } from '@angular/fire/storage';
import { Observable, catchError, map, of } from 'rxjs';
import type {
  GroupInvitationNotice,
  Member,
  Room,
  RoomInvitation,
  RoomMember,
  RoomMessage,
  StampRef,
  Thread,
} from '../models/firestore.models';
import type { PreparedImage } from '../utils/image';

export type WithId<T> = T & { id: string };

/**
 * トーク(ルーム方式の1対1・グループ)のデータアクセス。
 * メッセージは低レイテンシのためクライアントから直接書き込む(firestore.rulesで送信者本人・ルームのメンバーを検証)。
 * ルームの作成・招待・参加・退出はCloud Functions経由。
 * 会員エリアのルート(member.routes.ts)で提供する(Firestore SDKを初回読み込みに含めないため)。
 */
@Injectable()
export class RoomService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);
  private readonly storage = inject(Storage);

  /** 画像のダウンロードURLのキャッシュ(同じ画像を何度も問い合わせないため)。 */
  private readonly mediaUrls = new Map<string, Promise<string>>();

  /** 自分のトーク一覧(新着順)。 */
  listThreads(tenantId: string, memberId: string): Observable<WithId<Thread>[]> {
    const ref = collection(this.firestore, `tenants/${tenantId}/members/${memberId}/threads`);
    return collectionData(query(ref, orderBy('lastActivityAt', 'desc')), { idField: 'id' }) as Observable<
      WithId<Thread>[]
    >;
  }

  /** トーク一覧の自分の1行(未読数の確認に使う)。 */
  getThread(tenantId: string, memberId: string, roomId: string): Observable<Thread | undefined> {
    const ref = doc(this.firestore, `tenants/${tenantId}/members/${memberId}/threads/${roomId}`);
    return docData(ref) as Observable<Thread | undefined>;
  }

  /** 自分に届いているグループ招待(idはroomId)。 */
  listGroupInvitations(tenantId: string, memberId: string): Observable<WithId<GroupInvitationNotice>[]> {
    const ref = collection(this.firestore, `tenants/${tenantId}/members/${memberId}/groupInvitations`);
    return collectionData(query(ref, orderBy('createdAt', 'desc')), { idField: 'id' }) as Observable<
      WithId<GroupInvitationNotice>[]
    >;
  }

  /** ルーム。メンバーでない(退出した・存在しない)場合は null。 */
  getRoom(tenantId: string, roomId: string): Observable<WithId<Room> | null> {
    const ref = doc(this.firestore, `tenants/${tenantId}/rooms/${roomId}`);
    return (docData(ref) as Observable<Room | undefined>).pipe(
      map((room) => (room ? { ...room, id: roomId } : null)),
      catchError(() => of(null)),
    );
  }

  listRoomMembers(tenantId: string, roomId: string): Observable<WithId<RoomMember>[]> {
    const ref = collection(this.firestore, `tenants/${tenantId}/rooms/${roomId}/members`);
    return (collectionData(query(ref, orderBy('joinedAt', 'asc')), { idField: 'id' }) as Observable<
      WithId<RoomMember>[]
    >).pipe(catchError(() => of([])));
  }

  listPendingInvitations(tenantId: string, roomId: string): Observable<WithId<RoomInvitation>[]> {
    const ref = collection(this.firestore, `tenants/${tenantId}/rooms/${roomId}/invitations`);
    return (collectionData(query(ref, where('status', '==', 'pending')), { idField: 'id' }) as Observable<
      WithId<RoomInvitation>[]
    >).pipe(catchError(() => of([])));
  }

  /** 最新 count 件のメッセージ(古い順)。遡るときは count を増やして購読し直す(SPEC 5-7のページング)。 */
  listMessages(tenantId: string, roomId: string, count: number): Observable<WithId<RoomMessage>[]> {
    const ref = collection(this.firestore, `tenants/${tenantId}/rooms/${roomId}/messages`);
    return collectionData(query(ref, orderBy('createdAt', 'asc'), limitToLast(count)), {
      idField: 'id',
    }) as Observable<WithId<RoomMessage>[]>;
  }

  /** グループへの招待・作成で選べる、同じテナントの有効な会員。 */
  listActiveMembers(tenantId: string): Observable<WithId<Member>[]> {
    const ref = collection(this.firestore, `tenants/${tenantId}/members`);
    return collectionData(query(ref, where('isActive', '==', true)), { idField: 'id' }) as Observable<
      WithId<Member>[]
    >;
  }

  async sendText(tenantId: string, roomId: string, senderId: string, text: string): Promise<void> {
    await this.send(tenantId, roomId, { senderId, type: 'text', text });
  }

  async sendStamp(tenantId: string, roomId: string, senderId: string, stamp: StampRef): Promise<void> {
    const ref: StampRef = { packId: stamp.packId, stampId: stamp.stampId, ...(stamp.ownerId ? { ownerId: stamp.ownerId } : {}) };
    await this.send(tenantId, roomId, { senderId, type: 'stamp', stamp: ref });
  }

  /**
   * 画像を送る(SPEC 5-5)。端末で縮小・再エンコード済みの画像を、このメッセージ専用の Storage のパスに上げてから
   * メッセージを書き込む。onProgress には0〜1の送信の進み具合を渡す。
   */
  async sendImage(
    tenantId: string,
    roomId: string,
    senderId: string,
    image: PreparedImage,
    onProgress?: (ratio: number) => void,
  ): Promise<void> {
    const messageRef = doc(collection(this.firestore, `tenants/${tenantId}/rooms/${roomId}/messages`));
    const mediaPath = `tenants/${tenantId}/rooms/${roomId}/media/${messageRef.id}`;
    const path = `${mediaPath}/original.jpg`;
    const thumbPath = `${mediaPath}/thumb.jpg`;

    const total = image.original.size + image.thumb.size;
    const sent = new Map<string, number>();
    const upload = (filePath: string, blob: Blob) =>
      new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(ref(this.storage, filePath), blob, {
          contentType: 'image/jpeg',
          // 同じパスは上書きしない(storage.rules)ため、長期間キャッシュしてよい。
          cacheControl: 'private, max-age=31536000',
        });
        task.on(
          'state_changed',
          (snapshot) => {
            sent.set(filePath, snapshot.bytesTransferred);
            onProgress?.([...sent.values()].reduce((a, b) => a + b, 0) / total);
          },
          reject,
          () => resolve(),
        );
      });
    await Promise.all([upload(path, image.original), upload(thumbPath, image.thumb)]);

    await setDoc(messageRef, {
      senderId,
      type: 'image',
      media: {
        path,
        thumbPath,
        contentType: 'image/jpeg',
        width: image.width,
        height: image.height,
        size: image.original.size,
      },
      status: 'ready',
      createdAt: serverTimestamp(),
    });
  }

  /** 画像のダウンロードURL(ルームのメンバーだけが取得できる。storage.rules参照)。 */
  getMediaUrl(path: string): Promise<string> {
    let url = this.mediaUrls.get(path);
    if (!url) {
      url = getDownloadURL(ref(this.storage, path));
      url.catch(() => this.mediaUrls.delete(path));
      this.mediaUrls.set(path, url);
    }
    return url;
  }

  /** メッセージに自分のリアクションを付ける／外す(null)。1人1つ(firestore.rules参照)。 */
  async setReaction(
    tenantId: string,
    roomId: string,
    messageId: string,
    memberId: string,
    reaction: string | null,
  ): Promise<void> {
    const messageRef = doc(this.firestore, `tenants/${tenantId}/rooms/${roomId}/messages/${messageId}`);
    await updateDoc(messageRef, new FieldPath('reactions', memberId), reaction ?? deleteField());
  }

  /** トーク一覧の未読数を0にする(本人だけが、この更新だけをできる。firestore.rules参照)。 */
  async markRead(tenantId: string, memberId: string, roomId: string): Promise<void> {
    const ref = doc(this.firestore, `tenants/${tenantId}/members/${memberId}/threads/${roomId}`);
    await updateDoc(ref, { unreadCount: 0, lastReadAt: serverTimestamp() });
  }

  async createGroup(name: string, description: string, inviteeIds: string[]): Promise<string> {
    const fn = httpsCallable<{ name: string; description: string; inviteeIds: string[] }, { roomId: string }>(
      this.functions,
      'createGroup',
    );
    return (await fn({ name, description, inviteeIds })).data.roomId;
  }

  async inviteToGroup(roomId: string, inviteeIds: string[]): Promise<number> {
    const fn = httpsCallable<{ roomId: string; inviteeIds: string[] }, { invitedCount: number }>(
      this.functions,
      'inviteToGroup',
    );
    return (await fn({ roomId, inviteeIds })).data.invitedCount;
  }

  /** グループ招待に答える。expired は招待が取り消されていた(グループが削除された)場合。 */
  async respondToInvitation(roomId: string, accept: boolean): Promise<'accepted' | 'declined' | 'expired'> {
    const fn = httpsCallable<{ roomId: string; accept: boolean }, { status: 'accepted' | 'declined' | 'expired' }>(
      this.functions,
      'respondToGroupInvitation',
    );
    return (await fn({ roomId, accept })).data.status;
  }

  /** グループ管理者にする／外す(グループ管理者だけができる)。 */
  async setGroupAdmin(roomId: string, memberId: string, admin: boolean): Promise<void> {
    const fn = httpsCallable<{ roomId: string; memberId: string; admin: boolean }, unknown>(
      this.functions,
      'setGroupAdmin',
    );
    await fn({ roomId, memberId, admin });
  }

  /** グループから退出する。最後の1人が退出したときはグループが削除される(deleted: true)。 */
  async leaveGroup(roomId: string): Promise<{ deleted: boolean }> {
    const fn = httpsCallable<{ roomId: string }, { left: boolean; deleted: boolean }>(this.functions, 'leaveGroup');
    const { deleted } = (await fn({ roomId })).data;
    return { deleted };
  }

  private async send(
    tenantId: string,
    roomId: string,
    message: Pick<RoomMessage, 'senderId' | 'type' | 'text' | 'stamp'>,
  ): Promise<void> {
    const ref = collection(this.firestore, `tenants/${tenantId}/rooms/${roomId}/messages`);
    await addDoc(ref, { ...message, status: 'ready', createdAt: serverTimestamp() });
  }
}
