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
import type { Member, RoomMessage, StampRef } from '../../../core/models/firestore.models';
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

  loadOlder(): void {
    this.scrollToBottom = false;
    this.messageCount.update((count) => count + PAGE_SIZE);
  }

  applyTemplate(text: string): void {
    this.draftText.set(text);
  }

  async sendText(): Promise<void> {
    const session = this.memberSession();
    const text = this.draftText().trim();
    if (!session || !text) {
      return;
    }
    this.errorMessage.set('');
    this.sending.set(true);
    this.scrollToBottom = true;
    try {
      await this.roomService.sendText(session.tenantId, this.roomId(), session.memberId, text);
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
    if (!session) {
      return;
    }
    this.errorMessage.set('');
    this.scrollToBottom = true;
    try {
      await this.roomService.sendStamp(session.tenantId, this.roomId(), session.memberId, stamp);
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
    if (!file || !session) {
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
      await this.roomService.sendImage(session.tenantId, this.roomId(), session.memberId, image, (progress) =>
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
    const messages = this.messages();
    const message = messages[index];
    return this.isGroup() && !this.isMine(message) && messages[index - 1]?.senderId !== message.senderId;
  }
}
