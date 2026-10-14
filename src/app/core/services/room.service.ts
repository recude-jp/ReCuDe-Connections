import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
  FieldPath,
  Firestore,
  collection,
  collectionData,
  deleteField,
  doc,
  docData,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { Storage, getBytes, getDownloadURL, ref, uploadBytesResumable } from '@angular/fire/storage';
import { Observable, catchError, map, of } from 'rxjs';
import type {
  GroupInvitationNotice,
  Member,
  MessageContent,
  MessageReply,
  MessageMedia,
  Room,
  RoomInvitation,
  RoomMember,
  RoomMessage,
  StampRef,
  Thread,
} from '../models/firestore.models';
import type { PreparedImage } from '../utils/image';
import { E2eeService, RoomKeyContext } from './e2ee.service';

export type WithId<T> = T & { id: string };

/**
 * トーク(ルーム方式の1対1・グループ)のデータアクセス。
 * メッセージは低レイテンシのためクライアントから直接書き込む(firestore.rulesで送信者本人・ルームのメンバーを検証)。
 * メッセージの中身と画像は、送る前に端末でルームの鍵で暗号化する(E2eeService。SECURITY-DEVELOPMENT.md 6章)。
 * ルームの作成・招待・参加・退出はCloud Functions経由。
 * 会員エリアのルート(member.routes.ts)で提供する(Firestore SDKを初回読み込みに含めないため)。
 */
@Injectable()
export class RoomService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);
  private readonly storage = inject(Storage);
  private readonly e2ee = inject(E2eeService);

  /** 画像の表示用URLのキャッシュ(同じ画像を何度も取得・復号しないため)。 */
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
  /**
   * ルームの新しい方から count 件のメッセージ(古い順)。fromCache は、端末に残っている分だけでの仮の結果か
   * (件数を増やして読み直すと、まず手元の分だけが届き、その後にサーバーからの結果が届く。前のメッセージを
   * 読み終えたか・まだ前があるかは、サーバーからの結果で見分ける)。
   */
  listMessages(
    tenantId: string,
    roomId: string,
    count: number,
  ): Observable<{ list: WithId<RoomMessage>[]; fromCache: boolean }> {
    const ref = collection(this.firestore, `tenants/${tenantId}/rooms/${roomId}/messages`);
    const q = query(ref, orderBy('createdAt', 'asc'), limitToLast(count));
    return new Observable((subscriber) =>
      onSnapshot(
        q,
        { includeMetadataChanges: true },
        (snap) =>
          subscriber.next({
            list: snap.docs.map((d) => ({ ...(d.data() as RoomMessage), id: d.id })),
            fromCache: snap.metadata.fromCache,
          }),
        (err) => subscriber.error(err),
      ),
    );
  }

  /** グループへの招待・作成で選べる、同じテナントの有効な会員。 */
  listActiveMembers(tenantId: string): Observable<WithId<Member>[]> {
    const ref = collection(this.firestore, `tenants/${tenantId}/members`);
    return collectionData(query(ref, where('isActive', '==', true)), { idField: 'id' }) as Observable<
      WithId<Member>[]
    >;
  }

  /** replyTo は返信先(返信でなければ省く)。スタンプ・画像も同じ。 */
  async sendText(tenantId: string, room: RoomKeyContext, senderId: string, text: string, replyTo?: MessageReply): Promise<void> {
    await this.send(tenantId, room, senderId, 'text', { text, ...withReply(replyTo) });
  }

  async sendStamp(
    tenantId: string,
    room: RoomKeyContext,
    senderId: string,
    stamp: StampRef,
    replyTo?: MessageReply,
  ): Promise<void> {
    const ref: StampRef = { packId: stamp.packId, stampId: stamp.stampId, ...(stamp.ownerId ? { ownerId: stamp.ownerId } : {}) };
    await this.send(tenantId, room, senderId, 'stamp', { stamp: ref, ...withReply(replyTo) });
  }

  /**
   * 画像を送る(SPEC 5-5)。端末で縮小・再エンコード済みの画像をルームの鍵で暗号化し、このメッセージ専用の
   * Storage のパスに上げてからメッセージを書き込む。onProgress には0〜1の送信の進み具合を渡す。
   */
  async sendImage(
    tenantId: string,
    room: RoomKeyContext,
    senderId: string,
    image: PreparedImage,
    onProgress?: (ratio: number) => void,
    replyTo?: MessageReply,
  ): Promise<void> {
    const messageRef = doc(collection(this.firestore, `tenants/${tenantId}/rooms/${room.id}/messages`));
    const mediaPath = `tenants/${tenantId}/rooms/${room.id}/media/${messageRef.id}`;
    const path = `${mediaPath}/original.bin`;
    const thumbPath = `${mediaPath}/thumb.bin`;

    const [original, thumb] = await Promise.all([
      this.e2ee.encryptFile(room, path, await image.original.arrayBuffer()),
      this.e2ee.encryptFile(room, thumbPath, await image.thumb.arrayBuffer()),
    ]);

    const total = original.blob.size + thumb.blob.size;
    const sent = new Map<string, number>();
    const upload = (filePath: string, blob: Blob) =>
      new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(ref(this.storage, filePath), blob, {
          contentType: 'application/octet-stream',
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
    await Promise.all([upload(path, original.blob), upload(thumbPath, thumb.blob)]);

    const media: MessageMedia = {
      path,
      thumbPath,
      contentType: 'image/jpeg',
      width: image.width,
      height: image.height,
      size: image.original.size,
      epoch: original.epoch,
    };
    const enc = await this.e2ee.encryptMessage(room, messageRef.id, senderId, { media, ...withReply(replyTo) } satisfies MessageContent);
    await setDoc(messageRef, { senderId, type: 'image', enc, status: 'ready', createdAt: serverTimestamp() });
  }

  /**
   * 画像の表示用URL(ルームのメンバーだけが取得できる。storage.rules参照)。暗号化した画像は、取得して端末で
   * 復号し、ブラウザの中だけのURL(blob:)にする。which: 元の画像か縮小版か。
   */
  getMediaUrl(roomId: string, media: MessageMedia, which: 'original' | 'thumb'): Promise<string> {
    const path = which === 'original' ? media.path : media.thumbPath;
    let url = this.mediaUrls.get(path);
    if (!url) {
      url = media.epoch === undefined ? getDownloadURL(ref(this.storage, path)) : this.decryptMedia(roomId, media, path);
      url.catch(() => this.mediaUrls.delete(path));
      this.mediaUrls.set(path, url);
    }
    return url;
  }

  private async decryptMedia(roomId: string, media: MessageMedia, path: string): Promise<string> {
    const data = await getBytes(ref(this.storage, path));
    const plain = await this.e2ee.decryptFile(roomId, media.epoch!, path, data);
    if (!plain) {
      throw new Error('このトークの暗号鍵がまだ届いていません。');
    }
    return URL.createObjectURL(new Blob([plain], { type: media.contentType }));
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

  /** メッセージの中身を暗号化して書き込む(メッセージのIDを先に決め、暗号文をそのIDに結びつける)。 */
  private async send(
    tenantId: string,
    room: RoomKeyContext,
    senderId: string,
    type: RoomMessage['type'],
    content: MessageContent,
  ): Promise<void> {
    const messageRef = doc(collection(this.firestore, `tenants/${tenantId}/rooms/${room.id}/messages`));
    const enc = await this.e2ee.encryptMessage(room, messageRef.id, senderId, content);
    await setDoc(messageRef, { senderId, type, enc, status: 'ready', createdAt: serverTimestamp() });
  }
}

/** 返信先を、暗号化する中身に入れる形にする(Firestore に undefined は書けないため、返信でなければ何も足さない)。 */
function withReply(replyTo: MessageReply | undefined): Pick<MessageContent, 'replyTo'> {
  return replyTo ? { replyTo: { messageId: replyTo.messageId, senderId: replyTo.senderId, preview: replyTo.preview } } : {};
}
