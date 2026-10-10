import { Injectable, inject, signal } from '@angular/core';
import {
  Firestore,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
} from '@angular/fire/firestore';
import { distinctUntilChanged, map } from 'rxjs';
import { AuthService } from './auth.service';
import {
  EncryptedPayload,
  KeyBackup,
  WrappedRoomKey,
  decryptBytes,
  decryptJson,
  decryptKeyBackup,
  encryptBytes,
  encryptJson,
  encryptKeyBackup,
  generateMemberKeys,
  generateRoomKey,
  importPrivateKey,
  unwrapRoomKey,
  wrapRoomKey,
} from '../crypto/e2ee-crypto';
import { StoredMemberKey, loadMemberKey, saveMemberKey } from '../crypto/key-store';

/**
 * loading: 確認中。needs-setup: 鍵がまだ無い(パスフレーズを決めて作る)。needs-restore: この端末に鍵が無い
 * (パスフレーズでバックアップから戻す)。ready: 暗号化・復号できる。error: 確認できなかった。
 */
export type E2eeState = 'loading' | 'needs-setup' | 'needs-restore' | 'ready' | 'error';

/** 会員の公開鍵(tenants/[tenantId]/memberKeys/[memberId])。 */
interface MemberPublicKey {
  publicKey: JsonWebKey;
  keyId: string;
}

/** ルームの鍵を探す・作るのに必要な、ルームの情報。 */
export interface RoomKeyContext {
  id: string;
  memberIds: string[];
  /** ルームの鍵の今の世代(未設定は0)。 */
  keyEpoch?: number;
}

/** 鍵がまだ届いていない(ほかのメンバーが包んで渡すのを待っている)。 */
export class RoomKeyPendingError extends Error {
  constructor() {
    super('このトークの暗号鍵を受け取るのを待っています。ほかのメンバーがトークを開くと、送ったり読んだりできるようになります。');
    this.name = 'RoomKeyPendingError';
  }
}

/**
 * トークのエンドツーエンド暗号化(SECURITY-DEVELOPMENT.md 6章)。会員の鍵の作成・復元・バックアップと、
 * ルームの鍵の作成・配布、メッセージ・画像の暗号化・復号を行う。会員エリアのルート(member.routes.ts)で提供する。
 */
@Injectable()
export class E2eeService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(AuthService);

  readonly state = signal<E2eeState>('loading');

  private me: { tenantId: string; memberId: string } | null = null;
  private key: StoredMemberKey | null = null;
  /** ルームの鍵(`roomId/世代` → 鍵)。届いていないものは入れない。 */
  private readonly roomKeys = new Map<string, Promise<CryptoKey | null>>();
  private readonly publicKeys = new Map<string, Promise<MemberPublicKey | null>>();

  constructor() {
    this.auth.session$
      .pipe(
        map((session) => (session?.kind === 'member' ? { tenantId: session.tenantId, memberId: session.memberId } : null)),
        distinctUntilChanged((a, b) => a?.tenantId === b?.tenantId && a?.memberId === b?.memberId),
      )
      .subscribe((me) => void this.init(me));
  }

  private memberKeyRef(memberId: string) {
    return doc(this.firestore, `tenants/${this.me!.tenantId}/memberKeys/${memberId}`);
  }

  private backupRef() {
    return doc(this.firestore, `tenants/${this.me!.tenantId}/members/${this.me!.memberId}/e2ee/backup`);
  }

  private epochRef(roomId: string, epoch: number) {
    return doc(this.firestore, `tenants/${this.me!.tenantId}/rooms/${roomId}/keys/${epoch}`);
  }

  private wrappedRef(roomId: string, epoch: number, memberId: string) {
    return doc(this.firestore, `tenants/${this.me!.tenantId}/rooms/${roomId}/keys/${epoch}/members/${memberId}`);
  }

  private async init(me: { tenantId: string; memberId: string } | null): Promise<void> {
    this.me = me;
    this.key = null;
    this.roomKeys.clear();
    this.publicKeys.clear();
    if (!me) {
      this.state.set('loading');
      return;
    }
    this.state.set('loading');
    try {
      const [local, publicSnap, backupSnap] = await Promise.all([
        loadMemberKey(me.tenantId, me.memberId).catch(() => null),
        getDoc(this.memberKeyRef(me.memberId)),
        getDoc(this.backupRef()),
      ]);
      const published = publicSnap.data() as MemberPublicKey | undefined;
      if (local && published && published.keyId === local.keyId) {
        this.key = local;
        this.state.set('ready');
      } else {
        this.state.set(backupSnap.exists() ? 'needs-restore' : 'needs-setup');
      }
    } catch {
      this.state.set('error');
    }
  }

  /** 初めて使うとき: 鍵ペアを作り、パスフレーズで暗号化したバックアップと公開鍵を保存する。 */
  async setup(passphrase: string): Promise<void> {
    await this.createKeys(passphrase);
  }

  /** パスフレーズを忘れたとき: 鍵を作り直す(これまでの会話は読めなくなる)。 */
  async reset(passphrase: string): Promise<void> {
    await this.createKeys(passphrase);
  }

  private async createKeys(passphrase: string): Promise<void> {
    const me = this.requireMe();
    const generated = await generateMemberKeys();
    const backup = await encryptKeyBackup(generated.keyId, generated.privateJwk, passphrase);
    const batch = writeBatch(this.firestore);
    batch.set(this.memberKeyRef(me.memberId), {
      publicKey: generated.publicJwk,
      keyId: generated.keyId,
      updatedAt: serverTimestamp(),
    });
    batch.set(this.backupRef(), { ...backup, updatedAt: serverTimestamp() });
    await batch.commit();
    await this.useKey({ keyId: generated.keyId, privateKey: generated.privateKey });
  }

  /** 新しい端末: パスフレーズでバックアップから鍵を戻す。 */
  async restore(passphrase: string): Promise<void> {
    const me = this.requireMe();
    const backup = (await getDoc(this.backupRef())).data() as KeyBackup | undefined;
    if (!backup) {
      throw new Error('鍵のバックアップが見つかりません。');
    }
    const jwk = await decryptKeyBackup(backup, passphrase);
    // バックアップの鍵が公開している鍵と違う(別の端末で作り直した途中など)ときは、バックアップの鍵に揃える。
    const published = (await getDoc(this.memberKeyRef(me.memberId))).data() as MemberPublicKey | undefined;
    if (published?.keyId !== backup.keyId) {
      const { kty, crv, x, y } = jwk;
      await setDoc(this.memberKeyRef(me.memberId), {
        publicKey: { kty, crv, x, y },
        keyId: backup.keyId,
        updatedAt: serverTimestamp(),
      });
    }
    await this.useKey({ keyId: backup.keyId, privateKey: await importPrivateKey(jwk) });
  }

  /** パスフレーズを変える(今のパスフレーズでバックアップを開き、新しいパスフレーズで包み直す)。 */
  async changePassphrase(current: string, next: string): Promise<void> {
    this.requireMe();
    const backup = (await getDoc(this.backupRef())).data() as KeyBackup | undefined;
    if (!backup) {
      throw new Error('鍵のバックアップが見つかりません。');
    }
    const jwk = await decryptKeyBackup(backup, current);
    const rewrapped = await encryptKeyBackup(backup.keyId, jwk, next);
    await setDoc(this.backupRef(), { ...rewrapped, updatedAt: serverTimestamp() });
  }

  private async useKey(key: StoredMemberKey): Promise<void> {
    const me = this.requireMe();
    await saveMemberKey(me.tenantId, me.memberId, key).catch(() => undefined);
    this.key = key;
    this.roomKeys.clear();
    this.publicKeys.clear();
    this.state.set('ready');
  }

  private requireMe(): { tenantId: string; memberId: string } {
    if (!this.me) {
      throw new Error('ログインが必要です。');
    }
    return this.me;
  }

  private requireKey(): StoredMemberKey {
    if (!this.key) {
      throw new Error('暗号鍵の準備ができていません。');
    }
    return this.key;
  }

  private publicKeyOf(memberId: string): Promise<MemberPublicKey | null> {
    let entry = this.publicKeys.get(memberId);
    if (!entry) {
      entry = getDoc(this.memberKeyRef(memberId)).then((snap) => (snap.data() as MemberPublicKey | undefined) ?? null);
      entry.catch(() => this.publicKeys.delete(memberId));
      this.publicKeys.set(memberId, entry);
    }
    return entry;
  }

  private wrapContext(roomId: string, epoch: number, recipientId: string): string {
    return `${this.me!.tenantId}/${roomId}/${epoch}/${recipientId}`;
  }

  /**
   * ルームの、ある世代の鍵。自分あての鍵が届いていなければ null。
   * room を渡し、その世代がルームの今の世代で、まだ誰も鍵を作っていなければ、作ってメンバーに配る。
   */
  roomKey(roomId: string, epoch: number, room?: RoomKeyContext): Promise<CryptoKey | null> {
    const cacheKey = `${roomId}/${epoch}`;
    let entry = this.roomKeys.get(cacheKey);
    if (!entry) {
      entry = this.loadRoomKey(roomId, epoch, room);
      // 届いていない(null)・失敗したときは覚えない(あとで届いたら読めるように)。
      entry.then(
        (key) => key ?? this.roomKeys.delete(cacheKey),
        () => this.roomKeys.delete(cacheKey),
      );
      this.roomKeys.set(cacheKey, entry);
    }
    return entry;
  }

  private async loadRoomKey(roomId: string, epoch: number, room?: RoomKeyContext): Promise<CryptoKey | null> {
    const key = this.requireKey();
    const me = this.requireMe();
    const mine = await this.readWrapped(roomId, epoch, me.memberId);
    if (mine && mine.keyId === key.keyId) {
      return unwrapRoomKey(mine, key.privateKey, this.wrapContext(roomId, epoch, me.memberId));
    }
    if (!room || epoch !== (room.keyEpoch ?? 0)) {
      return null;
    }
    if ((await getDoc(this.epochRef(roomId, epoch))).exists()) {
      return null;
    }
    return this.createRoomKey(room, epoch);
  }

  private async readWrapped(roomId: string, epoch: number, memberId: string): Promise<WrappedRoomKey | null> {
    const snap = await getDoc(this.wrappedRef(roomId, epoch, memberId));
    return (snap.data() as WrappedRoomKey | undefined) ?? null;
  }

  /** その世代の鍵を作り、公開鍵があるメンバー全員に包んで配る。ほかの人が先に作っていたら、そちらを使う。 */
  private async createRoomKey(room: RoomKeyContext, epoch: number): Promise<CryptoKey | null> {
    const me = this.requireMe();
    const roomKey = await generateRoomKey();
    const wrapped = await this.wrapForMembers(room, epoch, roomKey);
    const created = await runTransaction(this.firestore, async (tx) => {
      const epochSnap = await tx.get(this.epochRef(room.id, epoch));
      if (epochSnap.exists()) {
        return false;
      }
      tx.set(this.epochRef(room.id, epoch), { createdBy: me.memberId, createdAt: serverTimestamp() });
      for (const [memberId, value] of wrapped) {
        tx.set(this.wrappedRef(room.id, epoch, memberId), { ...value, wrappedBy: me.memberId, updatedAt: serverTimestamp() });
      }
      return true;
    });
    if (created) {
      return roomKey;
    }
    const mine = await this.readWrapped(room.id, epoch, me.memberId);
    return mine && mine.keyId === this.requireKey().keyId
      ? unwrapRoomKey(mine, this.requireKey().privateKey, this.wrapContext(room.id, epoch, me.memberId))
      : null;
  }

  private async wrapForMembers(
    room: RoomKeyContext,
    epoch: number,
    roomKey: CryptoKey,
    onlyMemberIds?: string[],
  ): Promise<Map<string, WrappedRoomKey>> {
    const result = new Map<string, WrappedRoomKey>();
    await Promise.all(
      (onlyMemberIds ?? room.memberIds).map(async (memberId) => {
        const published = await this.publicKeyOf(memberId);
        if (published) {
          result.set(
            memberId,
            await wrapRoomKey(roomKey, published.publicKey, published.keyId, this.wrapContext(room.id, epoch, memberId)),
          );
        }
      }),
    );
    return result;
  }

  /**
   * 今の世代の鍵を、まだ持っていないメンバー(加わったばかり・鍵を作り直した人)に包んで渡す。
   * トークを開いたときに呼ぶ。自分が鍵を持っていなければ何もしない。
   */
  async distributeRoomKey(room: RoomKeyContext): Promise<void> {
    if (this.state() !== 'ready') {
      return;
    }
    const me = this.requireMe();
    const epoch = room.keyEpoch ?? 0;
    const roomKey = await this.roomKey(room.id, epoch, room);
    if (!roomKey) {
      return;
    }
    const needs: string[] = [];
    await Promise.all(
      room.memberIds
        .filter((id) => id !== me.memberId)
        .map(async (memberId) => {
          const [published, wrapped] = await Promise.all([
            this.publicKeyOf(memberId),
            this.readWrapped(room.id, epoch, memberId),
          ]);
          if (published && (!wrapped || wrapped.keyId !== published.keyId)) {
            needs.push(memberId);
          }
        }),
    );
    if (needs.length === 0) {
      return;
    }
    const wrapped = await this.wrapForMembers(room, epoch, roomKey, needs);
    const batch = writeBatch(this.firestore);
    for (const [memberId, value] of wrapped) {
      batch.set(this.wrappedRef(room.id, epoch, memberId), { ...value, wrappedBy: me.memberId, updatedAt: serverTimestamp() });
    }
    await batch.commit();
  }

  private messageAad(roomId: string, messageId: string, senderId: string): string {
    return `${this.me!.tenantId}/${roomId}/${messageId}/${senderId}`;
  }

  /** メッセージの中身を、ルームの今の世代の鍵で暗号化する。鍵が届いていなければ RoomKeyPendingError。 */
  async encryptMessage(room: RoomKeyContext, messageId: string, senderId: string, content: unknown): Promise<EncryptedPayload> {
    const epoch = room.keyEpoch ?? 0;
    const roomKey = await this.roomKey(room.id, epoch, room);
    if (!roomKey) {
      throw new RoomKeyPendingError();
    }
    return encryptJson(roomKey, epoch, content, this.messageAad(room.id, messageId, senderId));
  }

  /** メッセージの中身を復号する。鍵が届いていなければ null。 */
  async decryptMessage<T>(roomId: string, messageId: string, senderId: string, enc: EncryptedPayload): Promise<T | null> {
    const roomKey = await this.roomKey(roomId, enc.epoch);
    if (!roomKey) {
      return null;
    }
    return decryptJson<T>(roomKey, enc, this.messageAad(roomId, messageId, senderId));
  }

  /** 画像などのファイルを暗号化する(AAD は保存先のパス)。 */
  async encryptFile(room: RoomKeyContext, path: string, data: ArrayBuffer): Promise<{ blob: Blob; epoch: number }> {
    const epoch = room.keyEpoch ?? 0;
    const roomKey = await this.roomKey(room.id, epoch, room);
    if (!roomKey) {
      throw new RoomKeyPendingError();
    }
    return { blob: await encryptBytes(roomKey, data, path), epoch };
  }

  async decryptFile(roomId: string, epoch: number, path: string, data: ArrayBuffer): Promise<ArrayBuffer | null> {
    const roomKey = await this.roomKey(roomId, epoch);
    if (!roomKey) {
      return null;
    }
    return decryptBytes(roomKey, data, path);
  }
}
