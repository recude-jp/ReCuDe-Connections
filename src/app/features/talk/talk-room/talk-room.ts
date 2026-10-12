import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faChevronLeft, faCircleInfo, faFaceSmile, faImage } from '@fortawesome/free-solid-svg-icons';
import { combineLatest, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { AuthService, MemberSession } from '../../../core/services/auth.service';
import { MemberService } from '../../../core/services/member.service';
import { RoomService, WithId } from '../../../core/services/room.service';
import type { Member, MessageContent, RoomMessage, StampRef } from '../../../core/models/firestore.models';
import { E2eeService, RoomKeyContext } from '../../../core/services/e2ee.service';
import { MESSAGE_TEMPLATES, politenessTierFor } from '../../../core/utils/message-templates';
import { prepareImage } from '../../../core/utils/image';
import { MessageImage } from '../message-image/message-image';
import { StampPicker } from '../stamp-picker/stamp-picker';
import { MessageReactions } from '../message-reactions/message-reactions';
import { ImageViewer } from '../image-viewer/image-viewer';
import { StampImage } from '../../../shared/stamp-image/stamp-image';
import { MemberAvatar } from '../../../shared/member-avatar/member-avatar';
import { MemberProfileDialog } from '../member-profile-dialog/member-profile-dialog';
import { ReactionPicker } from '../reaction-picker/reaction-picker';
import { formatMessageTime } from '../../../core/utils/dates';
import { toErrorMessage } from '../../../core/utils/errors';

/** 一度に読むメッセージの件数(遡るときはこの件数ずつ増やす。SPEC 5-7)。 */
const PAGE_SIZE = 30;

/** 鍵が届いていないメッセージを、読み直す間隔(ほかのメンバーが鍵を渡してくれるのを待つ)。 */
const KEY_RETRY_MS = 15_000;

/**
 * 表示するメッセージ。暗号化したメッセージは、復号した中身(text・stamp・media)を重ねる。
 * decrypt: plain(暗号化を入れる前のメッセージ)、ok(復号できた)、pending(復号中)、no-key(鍵がまだ届いていない)、error(復号できない)。
 */
export type DisplayMessage = WithId<RoomMessage> & { decrypt: 'plain' | 'ok' | 'pending' | 'no-key' | 'error' };

type DecryptResult = { status: 'ok'; content: MessageContent } | { status: 'no-key' } | { status: 'error' };

/**
 * トーク画面(/talk/rooms/:roomId)。1対1・グループ共通。
 * 同じコンポーネントのままルームを切り替える(サイドバーで別のルームを選ぶ)ため、roomIdの変化に追従する。
 */
@Component({
  selector: 'app-talk-room',
  imports: [
    FormsModule,
    RouterLink,
    FaIconComponent,
    MessageImage,
    StampPicker,
    MessageReactions,
    ImageViewer,
    StampImage,
    MemberAvatar,
    MemberProfileDialog,
    ReactionPicker,
  ],
  templateUrl: './talk-room.html',
  styleUrl: './talk-room.scss',
  host: {
    '(document:click)': 'closeReactionPickerOnOutsideClick($event)',
    '(document:keydown.escape)': 'reactionTargetId.set(null)',
  },
})
export class TalkRoom {
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly roomService = inject(RoomService);
  private readonly memberService = inject(MemberService);
  private readonly e2ee = inject(E2eeService);

  readonly icons = { back: faChevronLeft, info: faCircleInfo, stamp: faFaceSmile, image: faImage };
  readonly templates = MESSAGE_TEMPLATES;
  readonly formatTime = formatMessageTime;

  readonly session = toSignal(this.auth.session$, { initialValue: undefined });
  readonly memberSession = computed(() => {
    const session = this.session();
    return session?.kind === 'member' ? (session as MemberSession) : null;
  });

  readonly roomId = toSignal(this.route.paramMap.pipe(map((params) => params.get('roomId') ?? '')), {
    initialValue: '',
  });

  /** 読み込むメッセージの件数。ルームを切り替えたら最初のページに戻す。 */
  readonly messageCount = signal(PAGE_SIZE);

  private readonly context$ = combineLatest([toObservable(this.memberSession), toObservable(this.roomId)]).pipe(
    distinctUntilChanged(([a, roomA], [b, roomB]) => a?.memberId === b?.memberId && roomA === roomB),
  );

  /** undefined = 読み込み中、null = 表示できない(メンバーでない・存在しない)。 */
  readonly room = toSignal(
    this.context$.pipe(
      switchMap(([session, roomId]) =>
        session && roomId ? this.roomService.getRoom(session.tenantId, roomId) : of(undefined),
      ),
    ),
    { initialValue: undefined },
  );

  readonly messages = toSignal(
    combineLatest([this.context$, toObservable(this.messageCount)]).pipe(
      switchMap(([[session, roomId], count]) =>
        session && roomId ? this.roomService.listMessages(session.tenantId, roomId, count) : of([]),
      ),
    ),
    { initialValue: [] as WithId<RoomMessage>[] },
  );

  private readonly thread = toSignal(
    this.context$.pipe(
      switchMap(([session, roomId]) =>
        session && roomId ? this.roomService.getThread(session.tenantId, session.memberId, roomId) : of(undefined),
      ),
    ),
  );

  /** メッセージの送信者名・相手の役職を出すため、ルームのメンバーのプロフィールを読む。 */
  readonly membersById = toSignal(
    toObservable(computed(() => this.room()?.memberIds ?? [])).pipe(
      distinctUntilChanged((a, b) => a.join() === b.join()),
      switchMap((ids) => {
        const session = this.memberSession();
        if (!session || ids.length === 0) {
          return of(new Map<string, Member>());
        }
        return combineLatest(ids.map((id) => this.memberService.getMember(session.tenantId, id))).pipe(
          map((members) => {
            const byId = new Map<string, Member>();
            members.forEach((member, i) => member && byId.set(ids[i], member));
            return byId;
          }),
        );
      }),
    ),
    { initialValue: new Map<string, Member>() },
  );

  /** ルームの鍵を探す・作るのに使う、ルームの情報。 */
  private readonly roomKeyContext = computed<RoomKeyContext | null>(() => {
    const room = this.room();
    return room ? { id: room.id, memberIds: room.memberIds, keyEpoch: room.keyEpoch } : null;
  }, {
    // 新着でルームの文書が変わるたびに、配り直し・見直しをしないように。
    equal: (a, b) =>
      a === b ||
      (!!a && !!b && a.id === b.id && a.keyEpoch === b.keyEpoch && a.memberIds.join() === b.memberIds.join()),
  });

  /** 復号した中身(メッセージID → 結果)。 */
  private readonly decrypted = signal(new Map<string, DecryptResult>());
  private readonly decrypting = new Set<string>();

  /** 表示するメッセージ(暗号化したものは復号した中身を重ねる)。 */
  readonly displayMessages = computed<DisplayMessage[]>(() => {
    const results = this.decrypted();
    return this.messages().map((message) => {
      if (!message.enc) {
        return { ...message, decrypt: 'plain' as const };
      }
      const result = results.get(message.id);
      if (!result) {
        return { ...message, decrypt: 'pending' as const };
      }
      return result.status === 'ok'
        ? { ...message, ...result.content, decrypt: 'ok' as const }
        : { ...message, decrypt: result.status };
    });
  });

  /** 鍵が届いていないメッセージがあるか(あれば、しばらくしてから読み直す)。 */
  private readonly hasMissingKeys = computed(() => this.displayMessages().some((m) => m.decrypt === 'no-key'));

  readonly isGroup = computed(() => this.room()?.type === 'group');

  readonly otherMember = computed(() => {
    const room = this.room();
    const myId = this.memberSession()?.memberId;
    if (!room || room.type !== 'direct') {
      return undefined;
    }
    const otherId = room.memberIds.find((id) => id !== myId);
    return otherId ? this.membersById().get(otherId) : undefined;
  });

  readonly title = computed(() => {
    const room = this.room();
    if (!room) {
      return '';
    }
    return room.type === 'group' ? (room.name ?? 'グループ') : `${this.otherMember()?.displayName ?? '会員'}さん`;
  });

  /** 例文の丁寧語。1対1は相手の役職で出し分け、グループは宛先が複数のため通常の丁寧語(SPEC 5-1)。 */
  readonly politenessTier = computed(() =>
    this.isGroup() ? 'peer' : politenessTierFor(this.otherMember()?.positionLevel),
  );

  readonly hasOlder = computed(() => this.messages().length >= this.messageCount());

  readonly draftText = signal('');
  readonly sending = signal(false);
  readonly errorMessage = signal('');

  /** スタンプ選択パネル(送信欄のボタンで開く)。 */
  readonly stampPanelOpen = signal(false);

  /** リアクションを選んでいるメッセージ(メッセージを押すと、その下に選択肢を出す)。 */
  readonly reactionTargetId = signal<string | null>(null);

  /** 送信中の画像(自分の画面では、送信が終わるまでプレビューと進み具合を先に出す)。 */
  readonly uploads = signal<{ id: number; previewUrl: string; progress: number }[]>([]);
  private uploadSeq = 0;

  /** 拡大表示中の画像のURL。 */
  readonly lightboxUrl = signal<string | null>(null);

  private readonly messagesEnd = viewChild<ElementRef<HTMLDivElement>>('messagesEnd');
  /** 遡って読み込んだときは最下部へスクロールしない。 */
  private scrollToBottom = true;

  constructor() {
    effect(() => {
      this.roomId();
      this.messageCount.set(PAGE_SIZE);
      this.draftText.set('');
      this.errorMessage.set('');
      this.stampPanelOpen.set(false);
      this.reactionTargetId.set(null);
      this.scrollToBottom = true;
    });

    effect(() => {
      this.messages();
      if (this.scrollToBottom) {
        queueMicrotask(() => this.messagesEnd()?.nativeElement.scrollIntoView({ block: 'end' }));
      }
    });

    // ルームを切り替えたら、復号の結果を捨てる。
    effect(() => {
      this.roomId();
      this.decrypted.set(new Map());
      this.decrypting.clear();
    });

    // 暗号化したメッセージを復号する(新しいメッセージが届いたとき・鍵の準備ができたとき)。
    effect(() => {
      const messages = this.messages();
      const roomId = this.roomId();
      if (this.e2ee.state() !== 'ready') {
        return;
      }
      for (const message of messages) {
        if (message.enc && !this.decrypted().has(message.id)) {
          void this.decryptOne(roomId, message);
        }
      }
    });

    // 鍵が届いていないメッセージは、ほかのメンバーが鍵を渡してくれるまで、しばらくおきに読み直す。
    effect((onCleanup) => {
      if (!this.hasMissingKeys()) {
        return;
      }
      const timer = setInterval(() => {
        this.decrypted.update((map) => new Map([...map].filter(([, result]) => result.status !== 'no-key')));
      }, KEY_RETRY_MS);
      onCleanup(() => clearInterval(timer));
    });

    // ルームを開いたら、今の世代の鍵をまだ持っていないメンバー(加わったばかり・鍵を作り直した人)に渡す。
    // 開いている間に、ほかのメンバーが鍵を作った(参加したばかりの人が鍵の設定を終えた)ときも、すぐ渡す。
    effect((onCleanup) => {
      const context = this.roomKeyContext();
      if (context && this.e2ee.state() === 'ready') {
        const distribute = () => void this.e2ee.distributeRoomKey(context).catch(() => undefined);
        distribute();
        onCleanup(this.e2ee.watchPublicKeys(context.memberIds, distribute));
      }
    });

    // 開いているルームに未読があれば既読にする(新着が届いたときも同様)。
    effect(() => {
      const session = this.memberSession();
      const thread = this.thread();
      const roomId = this.roomId();
      if (session && thread && thread.unreadCount > 0) {
        void this.roomService.markRead(session.tenantId, session.memberId, roomId).catch(() => undefined);
      }
    });
  }

  private async decryptOne(roomId: string, message: WithId<RoomMessage>): Promise<void> {
    if (this.decrypting.has(message.id)) {
      return;
    }
    this.decrypting.add(message.id);
    let result: DecryptResult;
    try {
      const content = await this.e2ee.decryptMessage<MessageContent>(roomId, message.id, message.senderId, message.enc!);
      result = content ? { status: 'ok', content } : { status: 'no-key' };
    } catch {
      result = { status: 'error' };
    } finally {
      this.decrypting.delete(message.id);
    }
    if (roomId === this.roomId()) {
      this.decrypted.update((map) => new Map(map).set(message.id, result));
    }
  }

  loadOlder(): void {
    this.scrollToBottom = false;
    this.messageCount.update((count) => count + PAGE_SIZE);
  }

  applyTemplate(text: string): void {
    this.draftText.set(text);
  }

  async sendText(): Promise<void> {
    const session = this.memberSession();
    const room = this.roomKeyContext();
    const text = this.draftText().trim();
    if (!session || !room || !text) {
      return;
    }
    this.errorMessage.set('');
    this.sending.set(true);
    this.scrollToBottom = true;
    try {
      await this.roomService.sendText(session.tenantId, room, session.memberId, text);
      this.draftText.set('');
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.sending.set(false);
    }
  }

  toggleStampPanel(): void {
    this.stampPanelOpen.update((open) => !open);
  }

  async sendStamp(stamp: StampRef): Promise<void> {
    const session = this.memberSession();
    const room = this.roomKeyContext();
    if (!session || !room) {
      return;
    }
    this.errorMessage.set('');
    this.scrollToBottom = true;
    try {
      await this.roomService.sendStamp(session.tenantId, room, session.memberId, stamp);
      // 送ったスタンプがトークに出たら、スタンプのパネルを閉じる(送れなかったときは選び直せるよう開いたまま)。
      this.stampPanelOpen.set(false);
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    }
  }

  async onImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const session = this.memberSession();
    const room = this.roomKeyContext();
    if (!file || !session || !room) {
      return;
    }
    this.errorMessage.set('');
    this.scrollToBottom = true;

    const id = ++this.uploadSeq;
    const previewUrl = URL.createObjectURL(file);
    this.uploads.update((list) => [...list, { id, previewUrl, progress: 0 }]);
    queueMicrotask(() => this.messagesEnd()?.nativeElement.scrollIntoView({ block: 'end' }));
    try {
      const image = await prepareImage(file);
      await this.roomService.sendImage(session.tenantId, room, session.memberId, image, (progress) =>
        this.uploads.update((list) => list.map((u) => (u.id === id ? { ...u, progress } : u))),
      );
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.uploads.update((list) => list.filter((u) => u.id !== id));
      URL.revokeObjectURL(previewUrl);
    }
  }

  /**
   * リアクションの選択肢の外(画面のどこでも)を押したら閉じる。リアクションのボタン・選択肢の中を押したときは、
   * それぞれの処理(開く／閉じる・リアクションを付ける)に任せる。
   */
  closeReactionPickerOnOutsideClick(event: MouseEvent): void {
    if (this.reactionTargetId() && !(event.target as Element | null)?.closest('.react-anchor')) {
      this.reactionTargetId.set(null);
    }
  }

  /** リアクションの選択肢を、ボタンの左に出すか(右に場所が無いとき)。 */
  readonly reactionPickerToLeft = signal(false);

  /** リアクションのボタンを押したときに、選択肢を出す／閉じる。右に場所が無ければ左に出す。 */
  toggleReactionPicker(messageId: string, event: MouseEvent): void {
    if (this.reactionTargetId() === messageId) {
      this.reactionTargetId.set(null);
      return;
    }
    const button = event.currentTarget as HTMLElement;
    const container = button.closest('.messages') ?? document.documentElement;
    // 選択肢(絵文字6つ)の幅の目安。
    const pickerWidth = 230;
    const spaceRight = container.getBoundingClientRect().right - button.getBoundingClientRect().right;
    this.reactionPickerToLeft.set(spaceRight < pickerWidth + 8);
    this.reactionTargetId.set(messageId);
  }

  /** リアクションした人の名前(チップの説明に出す)。 */
  readonly memberNames = computed(
    () => new Map([...this.membersById().entries()].map(([id, member]) => [id, member.displayName] as const)),
  );

  myReaction(message: RoomMessage): string | undefined {
    const myId = this.memberSession()?.memberId;
    return myId ? message.reactions?.[myId] : undefined;
  }

  /** 自分のリアクションを付ける。同じものをもう一度選ぶと外す(1人1つ)。 */
  async react(message: WithId<RoomMessage>, emoji: string): Promise<void> {
    const session = this.memberSession();
    if (!session) {
      return;
    }
    this.reactionTargetId.set(null);
    const next = this.myReaction(message) === emoji ? null : emoji;
    try {
      await this.roomService.setReaction(session.tenantId, this.roomId(), message.id, session.memberId, next);
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    }
  }

  /** オリジナルスタンプ導入前の絵文字スタンプか。 */
  isLegacyStamp(message: RoomMessage): message is RoomMessage & { stamp: string } {
    return typeof message.stamp === 'string';
  }

  stampRef(message: RoomMessage): StampRef | null {
    return message.stamp && typeof message.stamp !== 'string' ? message.stamp : null;
  }

  isMine(message: RoomMessage): boolean {
    return message.senderId === this.memberSession()?.memberId;
  }

  /** プロフィールを開いている人(メッセージのプロフィール画像を押したとき)。 */
  readonly profileMemberId = signal<string | null>(null);

  /** 送った人のプロフィール画像(未登録・退出した人は null。名前の最初の1文字を出す)。 */
  senderPhotoPath(message: RoomMessage): string | null {
    return this.membersById().get(message.senderId)?.photoPath ?? null;
  }

  senderName(message: RoomMessage): string {
    return this.membersById().get(message.senderId)?.displayName ?? '退出したメンバー';
  }

  /** グループで、直前と送信者が変わったメッセージにだけ送信者名を出す。 */
  showSender(index: number): boolean {
    const messages = this.displayMessages();
    const message = messages[index];
    return this.isGroup() && !this.isMine(message) && messages[index - 1]?.senderId !== message.senderId;
  }
}
