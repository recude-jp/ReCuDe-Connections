import { Injectable, inject, signal } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
} from '@angular/fire/firestore';
import { distinctUntilChanged, map } from 'rxjs';
import { AuthService } from './auth.service';
import { PasskeyService } from './passkey.service';
import {
  EncryptedPayload,
  KeyBackup,
  PasskeyKeyWrap,
  WrappedRoomKey,
  decryptBytes,
  decryptJson,
  decryptKeyBackup,
  encryptBytes,
  encryptJson,
  encryptKeyBackup,
  generateMemberKeys,
  generateRecoveryCode,
  generateRoomKey,
  importPrivateKey,
  normalizeRecoveryCode,
  prfSaltFor,
  unwrapKeyWithPrf,
  unwrapRoomKey,
  wrapKeyWithPrf,
  wrapRoomKey,
} from '../crypto/e2ee-crypto';
import { PrfUnavailableError, evaluatePrf } from '../crypto/e2ee-passkey';
import { StoredMemberKey, loadMemberKey, saveMemberKey } from '../crypto/key-store';
import { isAlreadyRegisteredError } from '../utils/errors';

/** 回復コードで暗号化した秘密鍵の控えのドキュメントID(members/[memberId]/e2ee/recovery)。 */
const RECOVERY_DOC_ID = 'recovery';
/** パスキーで暗号化した秘密鍵の控えのドキュメントIDの頭(passkey-[credentialId の SHA-256 の先頭40桁])。 */
const PASSKEY_DOC_PREFIX = 'passkey-';

/**
 * loading: 確認中。needs-setup: 鍵がまだ無い(作って、回復コードとパスキーで守る)。needs-restore: この端末に鍵が無い
 * (パスキーか回復コードで控えから戻す)。ready: 暗号化・復号できる。error: 確認できなかった。
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

/** 作っている途中・回復コードで戻した途中の鍵(保存して使い始める前)。 */
interface PendingKeys {
  kind: 'setup' | 'restore';
  keyId: string;
  privateJwk: JsonWebKey;
  privateKey: CryptoKey;
  publicJwk: JsonWebKey;
  /** kind が setup のとき、作った回復コード。 */
  recoveryCode?: string;
  /** この端末のパスキーで守った控え(finishPending で保存する)。 */
  passkeyWraps: PasskeyKeyWrap[];
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
  private readonly passkeys = inject(PasskeyService);

  readonly state = signal<E2eeState>('loading');
  /** 今の鍵を、パスキーで守った控えがあるか(新しい端末で、パスキーで戻せるか)。 */
  readonly hasPasskeyBackup = signal(false);

  private me: { tenantId: string; memberId: string } | null = null;
  private key: StoredMemberKey | null = null;
  private pending: PendingKeys | null = null;
  private passkeyWraps: PasskeyKeyWrap[] = [];
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

  /** 秘密鍵の控え(回復コード・パスキーで暗号化したもの)を置く場所。本人だけが読み書きできる。 */
  private backupsRef() {
    return collection(this.firestore, `tenants/${this.me!.tenantId}/members/${this.me!.memberId}/e2ee`);
  }

  private recoveryRef() {
    return doc(this.backupsRef(), RECOVERY_DOC_ID);
  }

  private async passkeyWrapRef(credentialId: string) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credentialId)));
    const hex = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
    return doc(this.backupsRef(), `${PASSKEY_DOC_PREFIX}${hex}`);
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
    this.pending = null;
    this.passkeyWraps = [];
    this.roomKeys.clear();
    this.publicKeys.clear();
    this.hasPasskeyBackup.set(false);
    this.state.set('loading');
    if (!me) {
      return;
    }
    try {
      const [local, publicSnap] = await Promise.all([
        loadMemberKey(me.tenantId, me.memberId).catch(() => null),
        getDoc(this.memberKeyRef(me.memberId)),
      ]);
      const published = publicSnap.data() as MemberPublicKey | undefined;
      if (local && published && published.keyId === local.keyId) {
        this.key = local;
        this.state.set('ready');
        return;
      }
      const backups = await this.loadBackups(published?.keyId);
      this.state.set(published && (backups.recovery || backups.passkeys.length > 0) ? 'needs-restore' : 'needs-setup');
    } catch {
      this.state.set('error');
    }
  }

  /** 今の鍵(keyId)の控えを読む(古い鍵の控えは使わない)。 */
  private async loadBackups(keyId: string | undefined): Promise<{ recovery: KeyBackup | null; passkeys: PasskeyKeyWrap[] }> {
    const snap = await getDocs(this.backupsRef());
    let recovery: KeyBackup | null = null;
    const passkeys: PasskeyKeyWrap[] = [];
    for (const backupDoc of snap.docs) {
      const data = backupDoc.data() as (KeyBackup | PasskeyKeyWrap) & { keyId: string };
      if (!keyId || data.keyId !== keyId) {
        continue;
      }
      if (backupDoc.id === RECOVERY_DOC_ID) {
        recovery = data as KeyBackup;
      } else if (backupDoc.id.startsWith(PASSKEY_DOC_PREFIX)) {
        passkeys.push(data as PasskeyKeyWrap);
      }
    }
    this.passkeyWraps = passkeys;
    this.hasPasskeyBackup.set(passkeys.length > 0);
    return { recovery, passkeys };
  }

  /**
   * 初めて使うとき(または、控えを失って作り直すとき): 鍵ペアと回復コードを作る(まだ保存しない)。
   * 回復コードを保管してもらったら、protectPendingWithPasskey(任意)と finishPending を呼ぶ。
   */
  async beginSetup(): Promise<string> {
    this.requireMe();
    const generated = await generateMemberKeys();
    const recoveryCode = generateRecoveryCode();
    this.pending = {
      kind: 'setup',
      keyId: generated.keyId,
      privateJwk: generated.privateJwk,
      privateKey: generated.privateKey,
      publicJwk: generated.publicJwk,
      recoveryCode,
      passkeyWraps: [],
    };
    return recoveryCode;
  }

  /** 新しい端末: 回復コードで鍵を戻す(まだ使い始めない。パスキーでも守るかを選んでから finishPending を呼ぶ)。 */
  async beginRestoreWithRecoveryCode(code: string): Promise<void> {
    const me = this.requireMe();
    const published = (await getDoc(this.memberKeyRef(me.memberId))).data() as MemberPublicKey | undefined;
    const { recovery } = await this.loadBackups(published?.keyId);
    if (!published || !recovery) {
      throw new Error('暗号鍵の控えが見つかりません。');
    }
    const privateJwk = await decryptKeyBackup(recovery, normalizeRecoveryCode(code));
    this.pending = {
      kind: 'restore',
      keyId: recovery.keyId,
      privateJwk,
      privateKey: await importPrivateKey(privateJwk),
      publicJwk: published.publicKey,
      passkeyWraps: [],
    };
  }

  /** 新しい端末: パスキー(引き継がれたもの)で鍵を戻して、使い始める。 */
  async restoreWithPasskey(): Promise<void> {
    const me = this.requireMe();
    const published = (await getDoc(this.memberKeyRef(me.memberId))).data() as MemberPublicKey | undefined;
    const { passkeys } = await this.loadBackups(published?.keyId);
    if (passkeys.length === 0) {
      throw new PrfUnavailableError();
    }
    const { credentialId, output } = await evaluatePrf(
      await prfSaltFor(me.tenantId, me.memberId),
      passkeys.map((w) => w.credentialId),
    );
    const wrap = passkeys.find((w) => w.credentialId === credentialId);
    if (!wrap) {
      throw new PrfUnavailableError();
    }
    const privateJwk = await unwrapKeyWithPrf(wrap, output);
    await this.useKey({ keyId: wrap.keyId, privateKey: await importPrivateKey(privateJwk) });
  }

  /**
   * 作っている途中(または回復コードで戻した)鍵を、この端末のパスキーでも守る。パスキーが無ければ登録する
   * (登録したパスキーはログインにも使える)。この端末に登録済みなら、そのパスキーを使う。
   */
  async protectPendingWithPasskey(): Promise<void> {
    const me = this.requireMe();
    const pending = this.pending;
    if (!pending) {
      throw new Error('暗号鍵の準備が始まっていません。');
    }
    const salt = await prfSaltFor(me.tenantId, me.memberId);
    let result: { credentialId: string; output: ArrayBuffer };
    try {
      const credentialId = await this.passkeys.register('member');
      this.passkeys.markLocalPasskeyHint('member', true);
      result = await evaluatePrf(salt, [credentialId]);
    } catch (err) {
      // この端末にはすでにパスキーがある(同じ認証器には重ねて登録できない)ときは、それを使う。
      if (!isAlreadyRegisteredError(err)) {
        throw err;
      }
      const ids = (await this.passkeys.list()).map((c) => c.credentialId);
      result = await evaluatePrf(salt, ids);
    }
    pending.passkeyWraps.push(await wrapKeyWithPrf(pending.keyId, result.credentialId, pending.privateJwk, result.output));
  }

  /** 準備した鍵と控えを保存して、使い始める。 */
  async finishPending(): Promise<void> {
    const me = this.requireMe();
    const pending = this.pending;
    if (!pending) {
      throw new Error('暗号鍵の準備が始まっていません。');
    }
    const batch = writeBatch(this.firestore);
    if (pending.kind === 'setup') {
      batch.set(this.memberKeyRef(me.memberId), { publicKey: pending.publicJwk, keyId: pending.keyId, updatedAt: serverTimestamp() });
      const recovery = await encryptKeyBackup(pending.keyId, pending.privateJwk, pending.recoveryCode!);
      batch.set(this.recoveryRef(), { ...recovery, updatedAt: serverTimestamp() });
      // 作り直す前の鍵の控え(古いパスフレーズの控えを含む)は、もう使えないので消す。
      for (const old of (await getDocs(this.backupsRef())).docs) {
        if (old.id !== RECOVERY_DOC_ID) {
          batch.delete(old.ref);
        }
      }
    }
    for (const wrap of pending.passkeyWraps) {
      batch.set(await this.passkeyWrapRef(wrap.credentialId), { ...wrap, updatedAt: serverTimestamp() });
    }
    await batch.commit();
    this.pending = null;
    await this.useKey({ keyId: pending.keyId, privateKey: pending.privateKey });
    if (pending.passkeyWraps.length > 0) {
      this.hasPasskeyBackup.set(true);
    }
  }

  cancelPending(): void {
    this.pending = null;
  }

  /**
   * 回復コードを作り直す(前のコードは使えなくなる)。鍵の中身が要るため、この端末のパスキー(控えのあるもの)で開く。
   */
  async regenerateRecoveryCode(): Promise<string> {
    const me = this.requireMe();
    const key = this.requireKey();
    const { passkeys } = await this.loadBackups(key.keyId);
    if (passkeys.length === 0) {
      throw new PrfUnavailableError();
    }
    const { credentialId, output } = await evaluatePrf(
      await prfSaltFor(me.tenantId, me.memberId),
      passkeys.map((w) => w.credentialId),
    );
    const wrap = passkeys.find((w) => w.credentialId === credentialId);
    if (!wrap) {
      throw new PrfUnavailableError();
    }
    const privateJwk = await unwrapKeyWithPrf(wrap, output);
    const recoveryCode = generateRecoveryCode();
    const recovery = await encryptKeyBackup(key.keyId, privateJwk, recoveryCode);
    await setDoc(this.recoveryRef(), { ...recovery, updatedAt: serverTimestamp() });
    return recoveryCode;
  }

  /** この端末のパスキーでも鍵を守る(回復コードで鍵を開いて、パスキーで包み直す)。 */
  async addPasskeyWithRecoveryCode(code: string): Promise<void> {
    const me = this.requireMe();
    const key = this.requireKey();
    const { recovery } = await this.loadBackups(key.keyId);
    if (!recovery) {
      throw new Error('暗号鍵の控えが見つかりません。');
    }
    const privateJwk = await decryptKeyBackup(recovery, normalizeRecoveryCode(code));
    const published = (await getDoc(this.memberKeyRef(me.memberId))).data() as MemberPublicKey;
    this.pending = {
      kind: 'restore',
      keyId: key.keyId,
      privateJwk,
      privateKey: key.privateKey,
      publicJwk: published.publicKey,
      passkeyWraps: [],
    };
    try {
      await this.protectPendingWithPasskey();
      await this.finishPending();
    } finally {
      this.pending = null;
    }
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
      // まだ公開鍵が無い(null)・失敗したときは覚えない(あとで鍵を作ったら渡せるように)。
      entry.then(
        (published) => published ?? this.publicKeys.delete(memberId),
        () => this.publicKeys.delete(memberId),
      );
      this.publicKeys.set(memberId, entry);
    }
    return entry;
  }

  /**
   * ほかのメンバーの公開鍵が作られた・作り直されたら、onChange を呼ぶ(開いているトークで、鍵をすぐ渡すため)。
   * 戻り値を呼ぶと見るのをやめる。
   */
  watchPublicKeys(memberIds: string[], onChange: () => void): () => void {
    if (!this.me) {
      return () => undefined;
    }
    const unsubscribes = memberIds
      .filter((id) => id !== this.me!.memberId)
      .map((memberId) => {
        let first = true;
        return onSnapshot(
          this.memberKeyRef(memberId),
          (snap) => {
            const published = (snap.data() as MemberPublicKey | undefined) ?? null;
            if (published) {
              this.publicKeys.set(memberId, Promise.resolve(published));
            } else {
              this.publicKeys.delete(memberId);
            }
            // 最初の読み込みは、トークを開いたときの配布で足りる。
            if (!first && published) {
              onChange();
            }
            first = false;
          },
          () => undefined,
        );
      });
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
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
