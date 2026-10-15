import { Component, ElementRef, Injector, afterNextRender, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faChevronLeft, faCircleInfo, faFaceSmile, faImage, faReply, faXmark } from '@fortawesome/free-solid-svg-icons';
import { combineLatest, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { AuthService, MemberSession } from '../../../core/services/auth.service';
import { MemberService } from '../../../core/services/member.service';
import { RoomService, WithId } from '../../../core/services/room.service';
import type { Member, MessageContent, MessageReply, RoomMessage, StampRef } from '../../../core/models/firestore.models';
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
import { Spinner } from '../../../shared/spinner/spinner';
import { linkify, TextSegment } from '../../../core/utils/linkify';

/**
 * 一度に読むメッセージの件数(遡るときもこの件数ずつ増やす。SPEC 5-7)。画面に収まる件数の2倍程度にする
 * (1件あたりの高さの目安 MESSAGE_HEIGHT_PX で、画面の高さから見積もる)。
 */
const MESSAGE_HEIGHT_PX = 44;
const MIN_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 60;

function pageSize(): number {
  const fit = Math.ceil(window.innerHeight / MESSAGE_HEIGHT_PX);
  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, fit * 2));
}

/** 上端からこの距離までスクロールしたら、前のメッセージを読み込み始める(上端に着く前に読み終えるように)。 */
const LOAD_OLDER_THRESHOLD_PX = 300;

/** 最下部からこの距離以内にいれば、新しいメッセージが届いたときに最下部までスクロールする。 */
const STICK_TO_BOTTOM_PX = 80;

/** 鍵が届いていないメッセージを、読み直す間隔(ほかのメンバーが鍵を渡してくれるのを待つ)。 */
const KEY_RETRY_MS = 15_000;

/** 同じ人がこの時間内に続けて送ったメッセージは、ひとかたまりに見せる(2通目からプロフィール画像と名前を省き、時刻は最後の1通だけ)。 */
const CONTINUE_WITHIN_MS = 5 * 60_000;

/** 返信先の要約の長さ(これより長い文は … で切る)。 */
const REPLY_PREVIEW_LENGTH = 60;

/** 返信先へ移動したとき、返信先のメッセージを目立たせる時間。 */
const HIGHLIGHT_MS = 1500;

/** 入力欄が広がる高さの上限(これを超えたら入力欄の中をスクロールする)。 */
const COMPOSER_MAX_HEIGHT_PX = 120;

/**
 * 表示するメッセージ。暗号化したメッセージは、復号した中身(text・stamp・media)を重ねる。
 * decrypt: plain(暗号化を入れる前のメッセージ)、ok(復号できた)、pending(復号中)、no-key(鍵がまだ届いていない)、error(復号できない)。
 */
export type DisplayMessage = WithId<RoomMessage> & {
  decrypt: 'plain' | 'ok' | 'pending' | 'no-key' | 'error';
  /** 返信先(暗号化した中身にだけ入る)。 */
  replyTo?: MessageReply;
};

/** 返信のメッセージの頭に出す、返信先の要約。 */
export interface ReplyQuote {
  messageId: string;
  senderName: string;
  preview: string;
}

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
    Spinner,
  ],
  templateUrl: './talk-room.html',
  styleUrl: './talk-room.scss',
  host: {
    '(document:click)': 'closeReactionPickerOnOutsideClick($event)',
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class TalkRoom {
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly roomService = inject(RoomService);
  private readonly memberService = inject(MemberService);
  private readonly e2ee = inject(E2eeService);

  readonly icons = {
    back: faChevronLeft,
    info: faCircleInfo,
    stamp: faFaceSmile,
    image: faImage,
    reply: faReply,
    close: faXmark,
  };
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

  /** 1ページの件数(画面の高さから決める)。 */
  private readonly pageSize = pageSize();
  /** 読み込むメッセージの件数。ルームを切り替えたら最初のページに戻す。 */
  readonly messageCount = signal(this.pageSize);

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

  /** 読み込んだメッセージと、何件を求めて読み込んだものか(前のメッセージの読み込みが終わったかを見分ける)。 */
  private readonly messagePage = toSignal(
    combineLatest([this.context$, toObservable(this.messageCount)]).pipe(
      switchMap(([[session, roomId], count]) =>
        (session && roomId
          ? this.roomService.listMessages(session.tenantId, roomId, count)
          : of({ list: [] as WithId<RoomMessage>[], fromCache: false })
        ).pipe(map((page) => ({ count, ...page }))),
      ),
    ),
    { initialValue: { count: 0, list: [] as WithId<RoomMessage>[], fromCache: true } },
  );

  readonly messages = computed(() => this.messagePage().list);

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
        ? { ...message, ...pickContent(result.content), decrypt: 'ok' as const }
        : { ...message, decrypt: result.status };
    });
  });

  /** 文のメッセージを、普通の文字と URL(リンクにする)に分けたもの(メッセージID → 分けた結果)。 */
  readonly textSegments = computed(() => {
    const segments = new Map<string, TextSegment[]>();
    for (const message of this.displayMessages()) {
      if (message.text) {
        segments.set(message.id, linkify(message.text));
      }
    }
    return segments;
  });

  private readonly messagesById = computed(() => new Map(this.displayMessages().map((m) => [m.id, m])));

  /**
   * 返信のメッセージの頭に出す、返信先の要約(メッセージID → 要約)。返信先が画面に読み込まれていれば、
   * 送った人の書いた要約ではなく、返信先そのものから作る(要約を偽って、ほかの人の発言に見せかけられないように)。
   */
  readonly replyQuotes = computed(() => {
    const quotes = new Map<string, ReplyQuote>();
    for (const message of this.displayMessages()) {
      const reply = message.replyTo;
      if (!reply || message.status === 'removed') {
        continue;
      }
      const original = this.messagesById().get(reply.messageId);
      const readable = original && (original.status === 'removed' || original.decrypt === 'plain' || original.decrypt === 'ok');
      quotes.set(message.id, {
        messageId: reply.messageId,
        senderName: this.senderNameById(readable ? original.senderId : reply.senderId),
        preview: readable ? this.replyPreviewOf(original) : reply.preview,
      });
    }
    return quotes;
  });

  /**
   * メッセージごとに、直前・直後のメッセージと同じかたまりか(同じ人が CONTINUE_WITHIN_MS 以内に続けて送ったか)。
   * fromPrevious: 2通目以降(プロフィール画像と名前を省く)。toNext: 最後の1通ではない(時刻を省く)。
   */
  readonly continuation = computed(() => {
    const messages = this.displayMessages();
    const continues = (a: DisplayMessage | undefined, b: DisplayMessage | undefined) =>
      !!a && !!b && a.senderId === b.senderId && Math.abs(sentAtMillis(b) - sentAtMillis(a)) <= CONTINUE_WITHIN_MS;
    return messages.map((message, i) => ({
      fromPrevious: continues(messages[i - 1], message),
      toNext: continues(message, messages[i + 1]),
    }));
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

  /** まだ前のメッセージがありそうか(サーバーから、求めた件数どおりに読み込めたら、まだ前がある)。 */
  readonly hasOlder = computed(() => {
    const page = this.messagePage();
    return page.count > 0 && !page.fromCache && page.list.length >= page.count;
  });

  readonly draftText = signal('');
  /** 返信しようとしているメッセージ(返信のボタンで選ぶ。送ったら外す)。 */
  readonly replyTarget = signal<DisplayMessage | null>(null);
  /** 返信先へ移動して、目立たせているメッセージ。 */
  readonly highlightedId = signal<string | null>(null);
  private highlightTimer?: ReturnType<typeof setTimeout>;
  readonly sending = signal(false);
  readonly errorMessage = signal('');

  /** スタンプ選択パネル(送信欄のボタンで開く)。 */
  readonly stampPanelOpen = signal(false);

  /** マウスを乗せている行のメッセージ(その行にだけ、リアクション・返信のボタンを出す)。 */
  readonly hoveredMessageId = signal<string | null>(null);

  /** リアクションを選んでいるメッセージ(メッセージを押すと、その下に選択肢を出す)。 */
  readonly reactionTargetId = signal<string | null>(null);

  /** 送信中の画像(自分の画面では、送信が終わるまでプレビューと進み具合を先に出す)。 */
  readonly uploads = signal<{ id: number; previewUrl: string; progress: number }[]>([]);
  private uploadSeq = 0;

  /** 拡大表示中の画像のURL。 */
  readonly lightboxUrl = signal<string | null>(null);

  private readonly injector = inject(Injector);
  private readonly messagesContainer = viewChild<ElementRef<HTMLDivElement>>('messagesContainer');
  private readonly messagesEnd = viewChild<ElementRef<HTMLDivElement>>('messagesEnd');
  private readonly composerInput = viewChild<ElementRef<HTMLTextAreaElement>>('composerInput');
  /** 最下部を見ているか(見ていれば、新しいメッセージが届いたとき・復号できたときに最下部までスクロールする)。 */
  private stickToBottom = true;
  /** 前のメッセージを読み込んでいる間、読み込む前のスクロールの位置(読み込んだ後、見ていたメッセージの位置を保つ)。 */
  private olderAnchor: { scrollHeight: number; scrollTop: number } | null = null;
  readonly loadingOlder = signal(false);

  constructor() {
    // 例文を入れたとき・送信して空にしたときも、入力欄の高さを合わせ直す。
    effect(() => {
      this.draftText();
      this.composerInput();
      queueMicrotask(() => this.resizeComposer());
    });

    effect(() => {
      this.roomId();
      this.messageCount.set(this.pageSize);
      this.olderAnchor = null;
      this.loadingOlder.set(false);
      this.draftText.set('');
      this.replyTarget.set(null);
      this.errorMessage.set('');
      this.stampPanelOpen.set(false);
      this.reactionTargetId.set(null);
      this.stickToBottom = true;
    });

    // メッセージが変わったら(届いた・前のメッセージを読み込んだ・復号できた)、描画の後にスクロールの位置を合わせる。
    effect(() => {
      this.displayMessages();
      const page = this.messagePage();
      // 手元の分だけでの仮の結果は、読み込みの完了とみなさない(-1)。
      const loadedCount = page.fromCache ? -1 : page.count;
      afterNextRender(() => this.afterMessagesRendered(loadedCount), { injector: this.injector });
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

  /** メッセージの一覧をスクロールしたとき。上端に近づいたら前のメッセージを読み込む。 */
  onMessagesScroll(): void {
    const el = this.messagesContainer()?.nativeElement;
    if (!el) {
      return;
    }
    this.stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_TO_BOTTOM_PX;
    if (el.scrollTop <= LOAD_OLDER_THRESHOLD_PX) {
      this.loadOlder();
    }
  }

  /** 前のメッセージを1ページ分読み込む(もう無いとき・読み込み中は何もしない)。 */
  private loadOlder(): void {
    const el = this.messagesContainer()?.nativeElement;
    if (!el || !this.hasOlder() || this.loadingOlder()) {
      return;
    }
    this.olderAnchor = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
    this.loadingOlder.set(true);
    this.messageCount.update((count) => count + this.pageSize);
  }

  /**
   * メッセージを描画した後。前のメッセージを読み込んだときは、上に増えた分だけずらして、見ていたメッセージの位置を保つ。
   * 最下部を見ていたときは、最下部までスクロールする。メッセージが画面を埋めていなければ、さらに前を読み込む。
   */
  private afterMessagesRendered(loadedCount: number): void {
    const el = this.messagesContainer()?.nativeElement;
    if (!el) {
      return;
    }
    if (this.olderAnchor) {
      // 増やした件数での、サーバーからの結果が届いたときだけ位置を戻す(それまでの描き直しは待つ)。
      if (loadedCount === this.messageCount()) {
        el.scrollTop = el.scrollHeight - this.olderAnchor.scrollHeight + this.olderAnchor.scrollTop;
        this.olderAnchor = null;
        this.loadingOlder.set(false);
      }
    } else if (this.stickToBottom) {
      el.scrollTop = el.scrollHeight;
    }
    if (el.scrollTop <= LOAD_OLDER_THRESHOLD_PX) {
      this.loadOlder();
    }
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
    this.stickToBottom = true;
    try {
      await this.roomService.sendText(session.tenantId, room, session.memberId, text, this.replyFor());
      this.draftText.set('');
      this.replyTarget.set(null);
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
    this.stickToBottom = true;
    try {
      await this.roomService.sendStamp(session.tenantId, room, session.memberId, stamp, this.replyFor());
      // 送ったスタンプがトークに出たら、スタンプのパネルを閉じる(送れなかったときは選び直せるよう開いたまま)。
      this.stampPanelOpen.set(false);
      this.replyTarget.set(null);
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
    this.stickToBottom = true;

    // 画像は送り終わるまで時間がかかるため、返信先は選んだ時点で決めて外す(送っている間に次の返信を選べるように)。
    const replyTo = this.replyFor();
    this.replyTarget.set(null);
    const id = ++this.uploadSeq;
    const previewUrl = URL.createObjectURL(file);
    this.uploads.update((list) => [...list, { id, previewUrl, progress: 0 }]);
    queueMicrotask(() => this.messagesEnd()?.nativeElement.scrollIntoView({ block: 'end' }));
    try {
      const image = await prepareImage(file);
      await this.roomService.sendImage(
        session.tenantId,
        room,
        session.memberId,
        image,
        (progress) => this.uploads.update((list) => list.map((u) => (u.id === id ? { ...u, progress } : u))),
        replyTo,
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
    return this.senderNameById(message.senderId);
  }

  private senderNameById(memberId: string): string {
    if (memberId === this.memberSession()?.memberId) {
      return 'あなた';
    }
    return this.membersById().get(memberId)?.displayName ?? '退出したメンバー';
  }

  /** 返信できるメッセージか(削除したもの・まだ読めないものには返信できない)。 */
  canReply(message: DisplayMessage): boolean {
    return message.status !== 'removed' && (message.decrypt === 'plain' || message.decrypt === 'ok');
  }

  /** 返信のボタンを押したとき。入力欄の上に返信先を出し、すぐ書き始められるようにする。 */
  startReply(message: DisplayMessage): void {
    this.replyTarget.set(message);
    this.reactionTargetId.set(null);
    queueMicrotask(() => this.composerInput()?.nativeElement.focus());
  }

  /** 返信先の要約(文は1行にして切る。スタンプ・写真は種類だけ)。 */
  replyPreviewOf(message: DisplayMessage): string {
    if (message.status === 'removed') {
      return '（削除されたメッセージ）';
    }
    if (message.type === 'image') {
      return '写真';
    }
    if (message.type === 'stamp') {
      return 'スタンプ';
    }
    const text = (message.text ?? '').replace(/\s+/g, ' ').trim();
    return text.length > REPLY_PREVIEW_LENGTH ? `${text.slice(0, REPLY_PREVIEW_LENGTH)}…` : text;
  }

  /** 送るメッセージに付ける返信先(返信でなければ undefined)。 */
  private replyFor(): MessageReply | undefined {
    const target = this.replyTarget();
    return target ? { messageId: target.id, senderId: target.senderId, preview: this.replyPreviewOf(target) } : undefined;
  }

  /** 返信の頭の要約を押したとき、返信先へ移動して少しの間目立たせる(読み込まれていなければ何もしない)。 */
  jumpToMessage(messageId: string): void {
    const element = document.getElementById(`message-${messageId}`);
    if (!element) {
      return;
    }
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    this.highlightedId.set(messageId);
    clearTimeout(this.highlightTimer);
    this.highlightTimer = setTimeout(() => this.highlightedId.set(null), HIGHLIGHT_MS);
  }

  /** Esc キー: 開いているリアクションの選択肢を閉じる。開いていなければ、返信をやめる。 */
  onEscape(): void {
    if (this.reactionTargetId()) {
      this.reactionTargetId.set(null);
    } else {
      this.replyTarget.set(null);
    }
  }

  /** グループで、かたまりの最初のメッセージにだけ送信者名を出す。 */
  showSender(index: number): boolean {
    const message = this.displayMessages()[index];
    return this.isGroup() && !this.isMine(message) && !this.continuation()[index]?.fromPrevious;
  }

  /**
   * 入力欄で Enter を押したとき。パソコンでは送信し(Shift+Enter は改行)、スマホでは改行する(送信はボタン)。
   * 日本語の変換を確定する Enter では送信しない。
   */
  onComposerEnter(event: KeyboardEvent): void {
    if (event.shiftKey || event.isComposing || event.keyCode === 229 || matchMedia('(pointer: coarse)').matches) {
      return;
    }
    event.preventDefault();
    void this.sendText();
  }

  /** 入力欄の高さを、書いた行数に合わせる(上限を超えたら中をスクロール)。 */
  private resizeComposer(): void {
    const textarea = this.composerInput()?.nativeElement;
    if (!textarea) {
      return;
    }
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
    textarea.style.overflowY = textarea.scrollHeight > COMPOSER_MAX_HEIGHT_PX ? 'auto' : 'hidden';
  }
}

/**
 * 復号した中身から、画面に出す項目だけを取り出す(中身に senderId などが紛れ込んでいても、メッセージの本来の値を上書きしない)。
 */
function pickContent(content: MessageContent): MessageContent {
  const { text, stamp, media, replyTo } = content;
  return {
    ...(typeof text === 'string' ? { text } : {}),
    ...(stamp ? { stamp } : {}),
    ...(media ? { media } : {}),
    ...(isReply(replyTo)
      ? { replyTo: { messageId: replyTo.messageId, senderId: replyTo.senderId, preview: replyTo.preview.slice(0, REPLY_PREVIEW_LENGTH + 1) } }
      : {}),
  };
}

function isReply(value: unknown): value is MessageReply {
  const reply = value as Partial<MessageReply> | undefined;
  return typeof reply?.messageId === 'string' && typeof reply.senderId === 'string' && typeof reply.preview === 'string';
}

/** メッセージを送った時刻(送信直後でサーバーの時刻がまだ付いていないものは、今)。 */
function sentAtMillis(message: RoomMessage): number {
  const value = message.createdAt;
  return value && 'toMillis' in value ? value.toMillis() : Date.now();
}
