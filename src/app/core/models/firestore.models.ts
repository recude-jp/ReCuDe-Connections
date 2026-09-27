import type { Timestamp, FieldValue } from '@angular/fire/firestore';

/**
 * Firestore データモデル型定義。
 * functions/src/models.ts と内容を揃えて保守する
 * (Angular側とFunctions側で別npmパッケージのため、現時点では複製管理)。
 */

export type PositionLevel = '会長' | '幹部' | '一般会員';

export interface TenantBranding {
  siteTitle?: string;
  logoUrl?: string;
  /** ファビコン(ロゴ画像から作った192×192の正方形のPNG)。未設定なら logoUrl を使う。 */
  faviconUrl?: string;
}

/**
 * プロフィール項目の入力方法。
 * text: 自由入力(これまでの入力が候補として出る)。select: 選択肢から1つ。tags: 複数入力(例: 趣味)。
 * yearMonth: 年と月(例: 生年月。値は "YYYY-MM")。
 * derived: 自動計算。別の項目からコンバーターで計算して決める(例: 生年月から年代)。本人は入力しない。
 */
export type ProfileFieldType = 'text' | 'select' | 'tags' | 'yearMonth' | 'derived';

/** コンバーターの種類(profileConverters.ts の登録簿)。 */
export type ProfileConverterId = 'ageGroup';

/** 自動計算の設定。source の項目の値を converter で変換する。 */
export interface ProfileDerivation {
  converter: ProfileConverterId;
  /** 変換元の項目のID。 */
  source: string;
}

/**
 * テナントごとのプロフィール項目(管理画面の「プロフィール項目」で設定する)。
 * 名前(displayName)とプロフィール画像(photoPath)は全テナント共通の固定項目で、ここには含めない。
 */
export interface ProfileField {
  /** 値の保存キー(member.profile[id])。一度決めたら変えない。入力候補は profileOptions/[id] に蓄積する。 */
  id: string;
  label: string;
  type: ProfileFieldType;
  /** select の選択肢。 */
  options?: string[];
  required?: boolean;
  /** つながるの会員検索の条件に出す。 */
  searchable?: boolean;
  /** 使わなくなった項目。入力・表示しない(入力済みの値は残す)。 */
  hidden?: boolean;
  /**
   * 非公開の項目(本人と管理者だけが見られる。例: 生年月)。値は会員データとは別の
   * members/[memberId]/private/profile に保存する(会員データは同じテナントの会員全員が読めるため)。
   */
  private?: boolean;
  /** type が derived のときの自動計算の設定。 */
  derive?: ProfileDerivation;
}

/**
 * 非公開のプロフィールの値(tenants/[tenantId]/members/[memberId]/private/profile)。
 * 本人と管理者だけが読める。書き込みは Cloud Functions だけ。
 */
export interface MemberPrivateProfile {
  values: ProfileValues;
  updatedAt: Timestamp | FieldValue;
}

/** 会員が入力したプロフィールの値(項目ID → 値。tags は配列)。 */
export type ProfileValues = Record<string, string | string[]>;

/** 会員条件の書き方。text: そのまま表示(改行を保つ)。html: HTMLとして表示(危険なタグ・属性は表示時に取り除く)。 */
export type MembershipTermsFormat = 'text' | 'html';

/**
 * 会員条件(会員になるための条件、年会費などの説明)。管理画面の「会員条件」で設定し、会員申請の画面に表示する。
 */
export interface MembershipTerms {
  format: MembershipTermsFormat;
  body: string;
  /** 会員申請のときに「確認し、同意します」のチェックを求める。 */
  requireAgreement: boolean;
  updatedAt: Timestamp | FieldValue;
}

export interface Tenant {
  name: string;
  prefecture: string;
  isActive: boolean;
  branding?: TenantBranding;
  /** プロフィール項目(並び順どおり)。未設定なら名前・プロフィール画像だけ。 */
  profileFields?: ProfileField[];
  /** 会員条件。未設定なら会員申請の画面に何も出さない。 */
  membershipTerms?: MembershipTerms;
  createdAt: Timestamp | FieldValue;
}

/**
 * 会員の区分。guest: 招待されて参加した人(トーク・出会いを探す・イベントの参照だけができる)。
 * community: 連携コミュニティへの招待で参加し、ルートコミュニティの会員ではない人(SPEC 9章。ルートの中ではゲストと同じ制限)。
 * member: 正規の会員(管理者が会員申請を承認した人)。
 */
export type MembershipStatus = 'guest' | 'community' | 'member';

/**
 * 連携コミュニティ(SPEC 9章。例: 在京高校同窓会)。tenants/[tenantId]/communities/[communityId]。
 * 追加・編集・削除はルートコミュニティの管理者が Cloud Functions 経由で行う。会員はだれでも読める(ロゴの表示に使う)。
 */
export interface Community {
  name: string;
  logoUrl?: string;
  /** ロゴが無いときに丸いアイコンに出す文字(2文字まで。未設定なら名称の頭文字)。 */
  logoText?: string;
  description?: string;
  /** 連携コミュニティの管理者(責任者)。ルートコミュニティの正規の会員。1人以上。 */
  adminIds: string[];
  /** 参加者数(有効な会員のみ)。 */
  memberCount: number;
  /** 参加者のうち、ルートコミュニティの正規の会員でもある人の数。 */
  rootMemberCount: number;
  /** 連携コミュニティ独自のプロフィール項目(ルートの項目に加えて使う。値は Member.communityProfiles)。 */
  profileFields?: ProfileField[];
  /** 連携コミュニティの参加の条件(参加の画面に出す)。 */
  membershipTerms?: MembershipTerms;
  /** true なら、招待で参加した人を連携コミュニティの管理者が承認してからメンバーにする(Member.communityApplications)。 */
  requireApproval?: boolean;
  createdBy: string;
  createdAt: Timestamp | FieldValue;
  updatedAt?: Timestamp | FieldValue;
}

/** 招待先。root: ルートコミュニティ(テナント本体)。community: 連携コミュニティ。 */
export interface InviteTarget {
  type: 'root' | 'community';
  communityId?: string;
}

/**
 * 管理の対象のコミュニティ(ルートコミュニティか連携コミュニティ)。管理画面・スタンプの使える範囲などで共通に使う。
 */
export type CommunityScope = InviteTarget;

export type MembershipApplicationStatus = 'pending' | 'approved' | 'rejected';

/** 正規の会員への申請。審査は管理者(事務局)が行う(会費の確認などもここで)。 */
export interface MembershipApplication {
  status: MembershipApplicationStatus;
  submittedAt: Timestamp | FieldValue;
  /** 会員条件に同意した記録(同意を求めていた場合)。 */
  termsAgreement?: { agreedAt: Timestamp | FieldValue; termsUpdatedAt: Timestamp | FieldValue | null };
  decidedAt?: Timestamp | FieldValue;
  /** 審査した管理者の会員ID。 */
  decidedBy?: string;
  /** 否認したときの理由(申請した人に表示する)。 */
  rejectReason?: string;
}

export interface Member {
  phoneNumber: string;
  displayName: string;
  /** プロフィール画像(Storage のパス。tenants/[tenantId]/members/[memberId]/photo/...)。 */
  photoPath?: string;
  /** プロフィール画像が無いときに丸いアイコンに出す文字(2文字まで。未設定なら名前の最初と最後の1文字)。 */
  avatarText?: string;
  /** テナントのプロフィール項目(Tenant.profileFields)の値。 */
  profile?: ProfileValues;
  /** 役職(例文の丁寧語の出し分けに使う。プロフィール項目とは別の、システムの項目)。 */
  positionLevel?: PositionLevel;
  /** 会員の区分。未設定は正規の会員(ゲストの仕組みを入れる前からの会員)。 */
  membership?: MembershipStatus;
  /** 正規の会員への申請(ゲストがマイページの「会員登録」から申請する)。 */
  membershipApplication?: MembershipApplication;
  /** 所属する連携コミュニティのID(複数所属できる)。 */
  communityIds?: string[];
  /** 管理者になっている連携コミュニティのID(Community.adminIds と揃える。カスタムクレームにも入れる)。 */
  adminCommunityIds?: string[];
  /** 連携コミュニティ独自のプロフィール項目の値(連携コミュニティのID → 値)。 */
  communityProfiles?: Record<string, ProfileValues>;
  /** 連携コミュニティへの参加の申請(承認が必要な連携コミュニティ。連携コミュニティのID → 申請)。 */
  communityApplications?: Record<string, MembershipApplication>;
  /** どの方法で招待されたか(ゲストとして参加したとき)。 */
  invitedVia?: 'qr' | 'invite';
  roles: {
    recommender: boolean;
    /** 管理者ロール。管理画面(/admin)に入れる。テナントに最低1人は必要。 */
    admin?: boolean;
  };
  isActive: boolean;
  invitedBy: string | null;
  createdAt: Timestamp | FieldValue;
}

/**
 * 招待の状態。invited: 送付済み(まだ参加していない)。joined: ゲストとして参加した。canceled: 取り消した。
 * submitted・approved・rejected は、ゲストの仕組みを入れる前の招待(推薦者が承認する方式)の状態。
 */
export type InviteStatus = 'invited' | 'joined' | 'canceled' | 'submitted' | 'approved' | 'rejected';

/** 候補者が登録申請で入力するプロフィール(承認されると会員の displayName・profile になる)。 */
export interface CandidateProfileInput {
  displayName: string;
  profile: ProfileValues;
}

/**
 * 招待(tenants/[tenantId]/invites/[inviteId])。「招待の送付」で作るものと、QRコードで参加した人の記録(via: 'qr')がある。
 * recommenderId は招待した会員(ゲストの仕組みを入れる前は認定推薦者だけが招待できたため、この名前のまま)。
 */
export interface Invite {
  /** 招待する人の名前(「招待の送付」で入力。参加するときの名前の初期値)。 */
  name?: string;
  /** 電話番号(E.164)とメールアドレスのどちらか(QRコードで参加した人は、参加した電話番号)。 */
  phoneNumber?: string;
  email?: string;
  recommenderId: string;
  via?: 'invite' | 'qr';
  /** 招待先。未設定はルートコミュニティ。 */
  target?: InviteTarget;
  /** 招待リンク(/join?code=...)のコード。inviteCodes/[code] に対応する。 */
  code?: string;
  status: InviteStatus;
  candidateProfile?: CandidateProfileInput;
  /** 会員条件に同意した記録(同意を求めていた場合)。 */
  termsAgreement?: { agreedAt: Timestamp | FieldValue; termsUpdatedAt: Timestamp | FieldValue | null };
  resultingMemberId?: string;
  createdAt: Timestamp | FieldValue;
  joinedAt?: Timestamp | FieldValue;
  submittedAt?: Timestamp | FieldValue;
  decidedAt?: Timestamp | FieldValue;
}

/** 入力候補の分類。プロフィール項目のID(ProfileField.id)。 */
export type ProfileOptionCategory = string;

export interface ProfileOptionValue {
  label: string;
  createdAt: Timestamp | FieldValue;
}

export type ConnectionStatus = 'pending' | 'accepted' | 'declined';

export interface Connection {
  memberIds: string[];
  requestedBy: string;
  status: ConnectionStatus;
  createdAt: Timestamp | FieldValue;
  respondedAt?: Timestamp | FieldValue;
}

export type MessageType = 'text' | 'stamp';

export type RoomType = 'direct' | 'group';

/** トークのルーム(1対1・グループ共通)。tenants/[tenantId]/rooms/[roomId]。directのroomIdはConnectionのID。 */
export interface Room {
  type: RoomType;
  memberIds: string[];
  memberCount: number;
  name?: string;
  description?: string;
  connectionId?: string;
  createdAt: Timestamp | FieldValue;
  lastMessageAt?: Timestamp | FieldValue;
}

/**
 * ルーム内の役割。admin はグループ管理者(テナントの管理者 roles.admin とは別物)。
 * グループには常に1人以上のグループ管理者がいる(複数人可)。
 */
export type RoomRole = 'admin' | 'member';

/** tenants/[tenantId]/rooms/[roomId]/members/[memberId] */
export interface RoomMember {
  role: RoomRole;
  joinedAt: Timestamp | FieldValue;
  invitedBy: string | null;
}

export type RoomInvitationStatus = 'pending' | 'accepted' | 'declined' | 'canceled';

/** tenants/[tenantId]/rooms/[roomId]/invitations/[inviteeId] */
export interface RoomInvitation {
  inviteeId: string;
  invitedBy: string;
  status: RoomInvitationStatus;
  createdAt: Timestamp | FieldValue;
  respondedAt?: Timestamp | FieldValue;
}

export type RoomMessageStatus = 'ready' | 'removed';

export type RoomMessageType = 'text' | 'stamp' | 'image';

/** マイスタンプ(会員が自分で登録したスタンプ)を表す packId。 */
export const CUSTOM_STAMP_PACK_ID = 'custom';

/**
 * スタンプの参照(画像のURLは持たない。SPEC 5-4)。
 * マイスタンプは packId が 'custom' で、ownerId(登録した会員)を持つ。送れるのは登録した本人だけ。
 */
export interface StampRef {
  packId: string;
  stampId: string;
  ownerId?: string;
}

/**
 * コミュニティのスタンプのパックのIDの頭に付ける文字(組み込みのパック・マイスタンプと区別するため)。
 * 組み込みのパック(stamps/)では、この文字で始まるIDを使えない(scripts/sync-stamps.mjs)。
 */
export const COMMUNITY_STAMP_PACK_PREFIX = 'tp-';

/** スタンプのパックを使える範囲。root: ルートコミュニティの正規の会員。community: その連携コミュニティのメンバー。 */
export type StampPackScope = CommunityScope;

/** コミュニティのスタンプ1つ(パックの stamps に、スタンプのIDをキーにして入れる)。 */
export interface CommunityStamp {
  /** スタンプの文言(代替テキスト・送信ボタンの読み上げに使う)。 */
  text: string;
  contentType: 'image/webp' | 'image/png';
  /** パネルでの並び順(小さい順)。 */
  order: number;
  /** true はパネルに出さない(送信済みのメッセージでは表示する)。 */
  hidden?: boolean;
  createdAt: Timestamp | FieldValue;
}

/**
 * コミュニティのスタンプのパック(管理 A2・SPEC 5-4)。tenants/[tenantId]/stampPacks/[packId](packId は tp- で始まる)。
 * ルートコミュニティと連携コミュニティごとに、管理者が管理画面(管理 > スタンプ)で登録する。
 * 画像は Storage の tenants/[tenantId]/stampPacks/[packId]/[stampId](上書きしない)。
 * パック・スタンプは消さずに非表示にする(送信済みのメッセージはスタンプのIDで画像を探すため)。
 */
export interface CommunityStampPack {
  name: string;
  scope: StampPackScope;
  hidden: boolean;
  stamps: Record<string, CommunityStamp>;
  createdBy: string;
  createdAt: Timestamp | FieldValue;
  updatedAt?: Timestamp | FieldValue;
}

/**
 * マイスタンプ。tenants/[tenantId]/members/[memberId]/stamps/[stampId]。
 * 画像は Storage の tenants/[tenantId]/members/[memberId]/stamps/[stampId](320×320以内の透過WebPまたはPNG)。
 */
export interface MyStamp {
  /** スタンプの名前(代替テキスト。任意)。 */
  text: string;
  contentType: 'image/webp' | 'image/png';
  createdAt: Timestamp | FieldValue;
}

/** 画像の参照とメタ情報。実体は Storage の tenants/[tenantId]/rooms/[roomId]/media/[messageId]/。 */
export interface MessageMedia {
  path: string;
  thumbPath: string;
  contentType: string;
  width: number;
  height: number;
  size: number;
}

/**
 * ルームのメッセージ。tenants/[tenantId]/rooms/[roomId]/messages/[messageId]。
 * stamp が文字列のものは、オリジナルスタンプ導入前の絵文字スタンプ(表示のみ対応)。
 */
export interface RoomMessage {
  senderId: string;
  type: RoomMessageType;
  text?: string;
  stamp?: StampRef | string;
  media?: MessageMedia;
  /** リアクション(会員ID → 絵文字。1人1つ)。本人が自分の分だけ付け外しできる。 */
  reactions?: Record<string, string>;
  status: RoomMessageStatus;
  createdAt: Timestamp | FieldValue;
}

/** 会員ごとのトーク一覧の1行。tenants/[tenantId]/members/[memberId]/threads/[roomId]。 */
export interface Thread {
  roomType: RoomType;
  title: string;
  otherMemberId?: string;
  lastMessageText: string;
  lastSenderId: string | null;
  lastMessageAt: Timestamp | FieldValue | null;
  lastActivityAt: Timestamp | FieldValue;
  unreadCount: number;
  lastReadAt: Timestamp | FieldValue | null;
}

/** 自分に届いているグループ招待。tenants/[tenantId]/members/[memberId]/groupInvitations/[roomId]。 */
export interface GroupInvitationNotice {
  roomName: string;
  invitedBy: string;
  invitedByName: string;
  createdAt: Timestamp | FieldValue;
}
