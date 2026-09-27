/**
 * Firebase Local Emulator Suite にサンプルデータを投入する開発用スクリプト。
 * テスト会員と、つながり・1対1のルーム・グループ・メッセージ・グループ招待・連携コミュニティを作る。
 * 山田太郎は最初の管理者として、管理者ロール・認定推薦者ロールを持つ。
 * テスト会員の一覧は DEVELOPMENT.md の「テスト会員」にも載せている(変更したら揃えること)。
 *
 * 何度実行しても同じ状態に戻る(固定IDで上書きする)。
 *
 * 実行前に `firebase emulators:start` でエミュレータを起動しておくこと。
 * 実行: npm --prefix functions run seed
 */
import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { buildMemberClaims } from '../src/memberClaims';
import type { Community, Member, ProfileField, ProfileValues, Room, RoomMember, RoomMessage, StampRef, Thread } from '../src/models';
import { applyDerivedValues } from '../src/profile';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || 'localhost:9199';

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'demo-recude-match';

admin.initializeApp({ projectId: PROJECT_ID, storageBucket: `${PROJECT_ID}.appspot.com` });
const db = admin.firestore();

const TENANT_ID = 'gifu-tokyo';

type SeedMember = Omit<Member, 'createdAt'> & { id: string };

/** 東京岐阜県人会のプロフィール項目(管理画面の「プロフィール項目」で変えられる)。名前・プロフィール画像は固定項目。 */
const PROFILE_FIELDS: ProfileField[] = [
  { id: 'hometown', label: '出身地', type: 'text', searchable: true },
  { id: 'highSchool', label: '出身高校', type: 'text', searchable: true },
  { id: 'juniorHighSchool', label: '出身中学', type: 'text', searchable: true },
  { id: 'club', label: '部活動', type: 'text', searchable: true },
  { id: 'hobby', label: '趣味', type: 'tags', searchable: true },
  // 生年月は非公開(本人と管理者だけ)。年代は生年月から自動で決まる(生年月の翌月から切り替え)。
  { id: 'birthYearMonth', label: '生年月', type: 'yearMonth', private: true },
  { id: 'ageGroup', label: '年代', type: 'derived', derive: { converter: 'ageGroup', source: 'birthYearMonth' }, searchable: true },
];

/** テスト会員の生年月(非公開。members/[id]/private/profile に入る)。高橋美咲は 2026年10月に 20代 → 30代 になる。 */
const BIRTH_YEAR_MONTHS: Record<string, string> = {
  'member-taro': '1992-08',
  'member-hanako': '2000-03',
  'member-ichiro': '1972-11',
  'member-misaki': '1996-09',
  'member-kenta': '1983-04',
  'member-yuki': '2002-09',
  'member-sho': '1999-12',
  'member-aoi': '2003-06',
};

/** テスト会員。電話番号はAuth Emulatorでのログインに使う(DEVELOPMENT.md参照)。 */
const MEMBERS: SeedMember[] = [
  {
    id: 'member-taro',
    phoneNumber: '+819012345678',
    displayName: '山田太郎',
    profile: { hometown: '岐阜市', highSchool: '岐阜北高校', juniorHighSchool: '岐阜東中学校', club: 'サッカー部', hobby: ['釣り', 'スキー'], ageGroup: '30代' },
    positionLevel: '一般会員',
    roles: { recommender: true, admin: true },
    // 連携コミュニティ「岐阜北高校 在京同窓会」の管理者(メンバーでもある)。
    communityIds: ['community-gifukita'],
    adminCommunityIds: ['community-gifukita'],
    isActive: true,
    invitedBy: null,
  },
  {
    id: 'member-hanako',
    phoneNumber: '+819012345679',
    displayName: '佐藤花子',
    profile: { hometown: '大垣市', highSchool: '大垣北高校', club: '吹奏楽部', hobby: ['登山'], ageGroup: '20代' },
    positionLevel: '一般会員',
    roles: { recommender: false, admin: false },
    isActive: true,
    invitedBy: 'member-taro',
  },
  {
    id: 'member-ichiro',
    phoneNumber: '+819012345680',
    displayName: '鈴木一郎',
    profile: { hometown: '高山市', highSchool: '斐太高校', club: '野球部', hobby: ['スキー', '釣り'], ageGroup: '50代' },
    positionLevel: '幹部',
    roles: { recommender: true, admin: false },
    isActive: true,
    invitedBy: 'member-taro',
  },
  {
    id: 'member-misaki',
    phoneNumber: '+819012345681',
    displayName: '高橋美咲',
    profile: { hometown: '岐阜市', highSchool: '岐阜北高校', club: 'バスケットボール部', hobby: ['登山', 'スキー'], ageGroup: '30代' },
    positionLevel: '一般会員',
    roles: { recommender: false, admin: false },
    communityIds: ['community-gifukita'],
    isActive: true,
    invitedBy: 'member-ichiro',
  },
  {
    id: 'member-kenta',
    phoneNumber: '+819012345682',
    displayName: '田中健太',
    profile: { hometown: '多治見市', highSchool: '多治見北高校', club: 'スキー部', hobby: ['スキー'], ageGroup: '40代' },
    positionLevel: '会長',
    roles: { recommender: true, admin: false },
    isActive: true,
    invitedBy: null,
  },
  {
    id: 'member-yuki',
    phoneNumber: '+819012345683',
    displayName: '伊藤ゆき',
    profile: { hometown: '関市', highSchool: '関高校', club: '陸上部', hobby: ['釣り'], ageGroup: '20代' },
    positionLevel: '一般会員',
    roles: { recommender: false, admin: false },
    isActive: true,
    invitedBy: 'member-kenta',
  },
  // ゲスト(招待されて参加し、まだ正規の会員でない人)。会員申請の審査待ち。
  {
    id: 'member-sho',
    phoneNumber: '+819012345684',
    displayName: '小林翔',
    profile: { hometown: '各務原市', highSchool: '各務原高校', club: 'テニス部', hobby: ['キャンプ'], ageGroup: '20代' },
    positionLevel: '一般会員',
    roles: { recommender: false, admin: false },
    membership: 'guest',
    membershipApplication: {
      status: 'pending',
      submittedAt: Timestamp.fromMillis(Date.now() - 60 * 60 * 1000),
      termsAgreement: { agreedAt: Timestamp.fromMillis(Date.now() - 60 * 60 * 1000), termsUpdatedAt: null },
    },
    invitedVia: 'qr',
    isActive: true,
    invitedBy: 'member-taro',
  },
  // ゲスト。まだ会員申請していない。
  {
    id: 'member-rin',
    phoneNumber: '+819012345685',
    displayName: '加藤りん',
    profile: {},
    positionLevel: '一般会員',
    roles: { recommender: false, admin: false },
    membership: 'guest',
    invitedVia: 'invite',
    isActive: true,
    invitedBy: 'member-hanako',
  },
  // 連携コミュニティ(岐阜北高校 在京同窓会)だけのメンバー。高橋美咲がQRコードで招待した。
  {
    id: 'member-aoi',
    phoneNumber: '+819012345686',
    displayName: '中村あおい',
    profile: {},
    positionLevel: '一般会員',
    roles: { recommender: false, admin: false },
    membership: 'community',
    communityIds: ['community-gifukita'],
    invitedVia: 'qr',
    isActive: true,
    invitedBy: 'member-misaki',
  },
];

/** 連携コミュニティ(SPEC 9章。管理画面の「連携コミュニティ」で追加・編集・削除できる)。 */
const COMMUNITIES: (Pick<Community, 'name' | 'description' | 'adminIds'> & { id: string })[] = [
  {
    id: 'community-gifukita',
    name: '岐阜北高校 在京同窓会',
    description: '東京近郊に住む岐阜北高校の卒業生の集まりです。',
    adminIds: ['member-taro'],
  },
];

/** 招待の記録(つながる > 招待 の「送った招待」に出る)。 */
const INVITES: {
  inviterId: string;
  name: string;
  via: 'qr' | 'invite';
  phoneNumber?: string;
  email?: string;
  memberId?: string;
  communityId?: string;
}[] = [
  { inviterId: 'member-taro', name: '小林翔', via: 'qr', phoneNumber: '+819012345684', memberId: 'member-sho' },
  { inviterId: 'member-hanako', name: '加藤りん', via: 'invite', phoneNumber: '+819012345685', memberId: 'member-rin' },
  {
    inviterId: 'member-misaki',
    name: '中村あおい',
    via: 'qr',
    phoneNumber: '+819012345686',
    memberId: 'member-aoi',
    communityId: 'community-gifukita',
  },
  // まだ参加していない招待(メールで送付)。
  { inviterId: 'member-taro', name: '岐阜太一', via: 'invite', email: 'taichi@example.com' },
];

const tenantRefFor = () => db.doc(`tenants/${TENANT_ID}`);

const nameOf = (id: string): string => MEMBERS.find((m) => m.id === id)?.displayName ?? '会員';

/** 投入時刻からの相対時刻(分前)でメッセージの日時を作る。 */
const minutesAgo = (minutes: number): Timestamp => Timestamp.fromMillis(Date.now() - minutes * 60 * 1000);

interface SeedMessage {
  from: string;
  text?: string;
  /** オリジナルスタンプ(src/app/core/utils/stamps.ts の STAMP_PACKS にあるもの)。 */
  stamp?: StampRef;
  /** リアクション(会員ID → 絵文字)。 */
  reactions?: Record<string, string>;
  minutesAgo: number;
}

interface SeedConnection {
  a: string;
  b: string;
  requestedBy: string;
  status: 'pending' | 'accepted';
  messages?: SeedMessage[];
}

interface SeedGroup {
  id: string;
  name: string;
  description?: string;
  /** 作成者(最初のグループ管理者)。 */
  creatorId: string;
  /** 作成者以外のメンバーと、その招待者。admin: true はグループ管理者。 */
  members: { id: string; invitedBy: string; admin?: boolean }[];
  /** 保留中の招待。 */
  invitations?: { inviteeId: string; invitedBy: string }[];
  messages: SeedMessage[];
}

const CONNECTIONS: SeedConnection[] = [
  {
    a: 'member-taro',
    b: 'member-hanako',
    requestedBy: 'member-hanako',
    status: 'accepted',
    messages: [
      {
        from: 'member-hanako',
        text: 'はじめまして！大垣出身の佐藤です。よろしくお願いします。',
        reactions: { 'member-taro': '😊' },
        minutesAgo: 60 * 26,
      },
      { from: 'member-taro', text: 'はじめまして！こちらこそよろしくお願いします。', minutesAgo: 60 * 25 },
      { from: 'member-taro', stamp: { packId: 'luka', stampId: 'yoroshiku' }, minutesAgo: 60 * 25 - 1 },
      { from: 'member-hanako', text: '来月の懇親会、参加されますか？', minutesAgo: 30 },
    ],
  },
  {
    a: 'member-taro',
    b: 'member-ichiro',
    requestedBy: 'member-taro',
    status: 'accepted',
    messages: [
      { from: 'member-taro', text: '先日はありがとうございました。今後ともよろしくお願いいたします。', minutesAgo: 60 * 48 },
      { from: 'member-ichiro', text: 'こちらこそ。釣りの話、また聞かせてください。', minutesAgo: 60 * 47 },
    ],
  },
  { a: 'member-ichiro', b: 'member-misaki', requestedBy: 'member-misaki', status: 'accepted' },
  { a: 'member-kenta', b: 'member-yuki', requestedBy: 'member-yuki', status: 'accepted' },
  // ゲストと、招待した人(参加したときに自動でつながる)。
  {
    a: 'member-sho',
    b: 'member-taro',
    requestedBy: 'member-taro',
    status: 'accepted',
    messages: [
      { from: 'member-taro', text: '先日の懇親会ではありがとうございました！QRコードから参加してくれてうれしいです。', minutesAgo: 60 * 3 },
      { from: 'member-sho', text: 'こちらこそ！会員登録も申請しました。よろしくお願いします。', minutesAgo: 60 * 2 },
    ],
  },
  { a: 'member-rin', b: 'member-hanako', requestedBy: 'member-hanako', status: 'accepted' },
  // 連携コミュニティだけのメンバーと、招待した人(同窓会の後輩と先輩)。
  {
    a: 'member-aoi',
    b: 'member-misaki',
    requestedBy: 'member-misaki',
    status: 'accepted',
    messages: [
      { from: 'member-misaki', text: '同窓会の集まりに来てくれてありがとう！ここで連絡を取り合いましょう。', minutesAgo: 60 * 5 },
      { from: 'member-aoi', text: 'ありがとうございます！よろしくお願いします。', minutesAgo: 60 * 4 },
    ],
  },
  // 山田太郎への未対応の申請(つながる > 申請 で承認を試せる)。
  { a: 'member-misaki', b: 'member-taro', requestedBy: 'member-misaki', status: 'pending' },
];

const GROUPS: SeedGroup[] = [
  {
    id: 'group-gifukita',
    name: '岐阜北高OB・OG会',
    description: '岐阜北高校の卒業生で、東京で集まりましょう。',
    creatorId: 'member-taro',
    members: [
      { id: 'member-hanako', invitedBy: 'member-taro' },
      // グループ管理者が複数いる例。
      { id: 'member-misaki', invitedBy: 'member-taro', admin: true },
    ],
    invitations: [{ inviteeId: 'member-yuki', invitedBy: 'member-misaki' }],
    messages: [
      { from: 'member-taro', text: 'グループを作りました！岐阜北高の皆さん、よろしくお願いします。', minutesAgo: 60 * 72 },
      { from: 'member-misaki', text: 'ありがとうございます！高橋です。バスケ部でした。', minutesAgo: 60 * 71 },
      { from: 'member-hanako', stamp: { packId: 'komame', stampId: 'hihiin' }, minutesAgo: 60 * 70 },
      {
        from: 'member-misaki',
        text: '今度、新橋で飲みませんか？',
        reactions: { 'member-taro': '👍', 'member-hanako': '👍' },
        minutesAgo: 90,
      },
      { from: 'member-hanako', text: 'いいですね！金曜ならいけます。', minutesAgo: 80 },
    ],
  },
  {
    id: 'group-fishing',
    name: '東京で釣り部',
    description: '長良川が恋しい釣り好きの集まり。',
    creatorId: 'member-ichiro',
    members: [
      { id: 'member-taro', invitedBy: 'member-ichiro' },
      { id: 'member-yuki', invitedBy: 'member-taro' },
    ],
    messages: [
      { from: 'member-ichiro', text: '週末、多摩川で鮎を狙います。どなたか一緒にいかがですか。', minutesAgo: 60 * 5 },
      { from: 'member-yuki', text: '行きたいです！道具を持っていないのですが大丈夫ですか？', minutesAgo: 60 * 4 },
      { from: 'member-ichiro', text: '貸せますよ。', minutesAgo: 60 * 4 - 10 },
    ],
  },
  {
    id: 'group-ski',
    name: '週末スキー部',
    creatorId: 'member-kenta',
    members: [{ id: 'member-misaki', invitedBy: 'member-kenta' }],
    // 山田太郎への保留中の招待(トーク一覧の「グループ招待」で参加する／断るを試せる)。
    invitations: [{ inviteeId: 'member-taro', invitedBy: 'member-kenta' }],
    messages: [{ from: 'member-kenta', text: '今シーズンも奥美濃に行きましょう！', minutesAgo: 60 * 10 }],
  },
];

function summarize(message: SeedMessage): string {
  return message.stamp ? 'スタンプ' : (message.text ?? '');
}

/** 各メンバーの未読数 = そのメンバーが最後に送ったメッセージより後の、他の人のメッセージ数。 */
function unreadCountFor(memberId: string, messages: SeedMessage[]): number {
  const sorted = [...messages].sort((x, y) => y.minutesAgo - x.minutesAgo);
  const lastOwnIndex = sorted.map((m) => m.from).lastIndexOf(memberId);
  return sorted.slice(lastOwnIndex + 1).filter((m) => m.from !== memberId).length;
}

/** ルーム・メンバー・メッセージ・メンバー全員のトーク一覧を書き込む。 */
async function writeRoom(
  roomId: string,
  room: Room,
  members: { id: string; roomMember: RoomMember; threadTitle: string; otherMemberId?: string }[],
  messages: SeedMessage[],
): Promise<void> {
  const batch = db.batch();
  const roomRef = db.doc(`tenants/${TENANT_ID}/rooms/${roomId}`);
  const sorted = [...messages].sort((x, y) => y.minutesAgo - x.minutesAgo);
  const last = sorted[sorted.length - 1];

  batch.set(roomRef, { ...room, ...(last ? { lastMessageAt: minutesAgo(last.minutesAgo) } : {}) });
  sorted.forEach((m, i) => {
    const message: RoomMessage = {
      senderId: m.from,
      type: m.stamp ? 'stamp' : 'text',
      ...(m.text ? { text: m.text } : {}),
      ...(m.stamp ? { stamp: m.stamp } : {}),
      ...(m.reactions ? { reactions: m.reactions } : {}),
      status: 'ready',
      createdAt: minutesAgo(m.minutesAgo),
      // 投入データはトーク一覧をここで作るため、onRoomMessageCreated に反映させない。
      threadsUpdated: true,
    };
    batch.set(roomRef.collection('messages').doc(`seed-${String(i).padStart(3, '0')}`), message);
  });

  for (const member of members) {
    batch.set(roomRef.collection('members').doc(member.id), member.roomMember);
    const thread: Thread = {
      roomType: room.type,
      title: member.threadTitle,
      ...(member.otherMemberId ? { otherMemberId: member.otherMemberId } : {}),
      lastMessageText: last ? summarize(last) : '',
      lastSenderId: last?.from ?? null,
      lastMessageAt: last ? minutesAgo(last.minutesAgo) : null,
      lastActivityAt: last ? minutesAgo(last.minutesAgo) : FieldValue.serverTimestamp(),
      unreadCount: unreadCountFor(member.id, messages),
      lastReadAt: null,
    };
    batch.set(db.doc(`tenants/${TENANT_ID}/members/${member.id}/threads/${roomId}`), thread);
  }
  await batch.commit();
}

/** 以前の投入で作られたトーク関連のデータを消す(何度実行しても同じ状態に戻すため)。 */
async function clearTalkData(): Promise<void> {
  const tenantRef = db.doc(`tenants/${TENANT_ID}`);
  const roomsSnap = await tenantRef.collection('rooms').get();
  const connectionsSnap = await tenantRef.collection('connections').get();
  for (const snap of [...roomsSnap.docs, ...connectionsSnap.docs]) {
    await db.recursiveDelete(snap.ref);
  }
  for (const member of MEMBERS) {
    for (const sub of ['threads', 'groupInvitations']) {
      await db.recursiveDelete(tenantRef.collection('members').doc(member.id).collection(sub));
    }
  }
  // 招待の記録と招待リンクのコード。
  for (const snap of (await tenantRef.collection('invites').get()).docs) {
    await snap.ref.delete();
  }
  for (const snap of (await db.collection('inviteCodes').where('tenantId', '==', TENANT_ID).get()).docs) {
    await snap.ref.delete();
  }
  // テスト中に送った画像(Storage Emulator)も消す。
  await admin.storage().bucket().deleteFiles({ prefix: `tenants/${TENANT_ID}/rooms/` });
}

async function seed(): Promise<void> {
  await db.doc(`tenants/${TENANT_ID}`).set({
    name: '東京岐阜県人会',
    prefecture: '岐阜県',
    isActive: true,
    branding: {
      siteTitle: 'TOKYO GIFU CONNECT',
    },
    profileFields: PROFILE_FIELDS,
    // 会員条件(管理画面の「会員条件」で変えられる)。会員申請の画面に出る。
    membershipTerms: {
      format: 'text',
      body:
        '東京岐阜県人会の会員になるには、次の条件があります。\n\n' +
        '・岐阜県出身、または岐阜県にゆかりのある方\n' +
        '・年会費 2,000円（毎年4月に事務局からご案内します）\n\n' +
        '会費のお支払いが確認できた時点で、正会員となります。',
      requireAgreement: true,
      updatedAt: FieldValue.serverTimestamp(),
    },
    createdAt: FieldValue.serverTimestamp(),
  });

  for (const { id, ...member } of MEMBERS) {
    // 年代(自動計算)を生年月から決め、生年月は非公開の場所に置く。
    const privateValues: ProfileValues = BIRTH_YEAR_MONTHS[id] ? { birthYearMonth: BIRTH_YEAR_MONTHS[id] } : {};
    const profile = { ...(member.profile ?? {}) };
    delete profile['ageGroup'];
    applyDerivedValues(PROFILE_FIELDS, profile, privateValues, {});
    // パスキー・PINの登録(サブコレクション)を消さないよう、会員ドキュメントだけを上書きする。
    await db.doc(`tenants/${TENANT_ID}/members/${id}`).set({ ...member, profile, createdAt: FieldValue.serverTimestamp() });
    await db.doc(`tenants/${TENANT_ID}/members/${id}/private/profile`).set({ values: privateValues, updatedAt: FieldValue.serverTimestamp() });
    await db.doc(`phoneIndex/${member.phoneNumber}`).set({ tenantId: TENANT_ID, memberId: id });
  }

  await clearTalkData();

  // 連携コミュニティ(参加者数は会員の所属から数える)。
  for (const snap of (await tenantRefFor().collection('communities').get()).docs) {
    await snap.ref.delete();
  }
  for (const { id, ...community } of COMMUNITIES) {
    const members = MEMBERS.filter((m) => m.isActive && (m.communityIds ?? []).includes(id));
    await tenantRefFor().collection('communities').doc(id).set({
      ...community,
      memberCount: members.length,
      rootMemberCount: members.filter((m) => !m.membership || m.membership === 'member').length,
      createdBy: 'member-taro',
      createdAt: minutesAgo(60 * 24 * 10),
    } satisfies Community);
  }

  // つながりと1対1のルーム(roomId = connectionId)。
  for (const c of CONNECTIONS) {
    const memberIds = [c.a, c.b].sort();
    const connectionId = memberIds.join('_');
    await db.doc(`tenants/${TENANT_ID}/connections/${connectionId}`).set({
      memberIds,
      requestedBy: c.requestedBy,
      status: c.status,
      createdAt: minutesAgo(60 * 24 * 7),
      ...(c.status === 'accepted' ? { respondedAt: minutesAgo(60 * 24 * 6) } : {}),
    });
    if (c.status !== 'accepted') {
      continue;
    }
    const joinedAt = minutesAgo(60 * 24 * 6);
    await writeRoom(
      connectionId,
      { type: 'direct', memberIds, memberCount: 2, connectionId, createdAt: joinedAt },
      memberIds.map((id) => {
        const otherId = memberIds.find((other) => other !== id)!;
        return {
          id,
          roomMember: { role: 'member', joinedAt, invitedBy: null },
          threadTitle: nameOf(otherId),
          otherMemberId: otherId,
        };
      }),
      c.messages ?? [],
    );
  }

  // グループ。
  for (const g of GROUPS) {
    const createdAt = minutesAgo(60 * 24 * 5);
    const memberIds = [g.creatorId, ...g.members.map((m) => m.id)];
    await writeRoom(
      g.id,
      {
        type: 'group',
        name: g.name,
        ...(g.description ? { description: g.description } : {}),
        memberIds,
        memberCount: memberIds.length,
        createdAt,
      },
      [
        { id: g.creatorId, roomMember: { role: 'admin', joinedAt: createdAt, invitedBy: null }, threadTitle: g.name },
        ...g.members.map((m, i) => ({
          id: m.id,
          roomMember: {
            role: m.admin ? ('admin' as const) : ('member' as const),
            joinedAt: minutesAgo(60 * 24 * 5 - (i + 1) * 10),
            invitedBy: m.invitedBy,
          },
          threadTitle: g.name,
        })),
      ],
      g.messages,
    );

    for (const inv of g.invitations ?? []) {
      await db.doc(`tenants/${TENANT_ID}/rooms/${g.id}/invitations/${inv.inviteeId}`).set({
        inviteeId: inv.inviteeId,
        invitedBy: inv.invitedBy,
        status: 'pending',
        createdAt: minutesAgo(60 * 3),
      });
      await db.doc(`tenants/${TENANT_ID}/members/${inv.inviteeId}/groupInvitations/${g.id}`).set({
        roomName: g.name,
        invitedBy: inv.invitedBy,
        invitedByName: nameOf(inv.invitedBy),
        createdAt: minutesAgo(60 * 3),
      });
    }
  }

  // 招待の記録(参加済みのものは joined)。
  for (const inv of INVITES) {
    await tenantRefFor().collection('invites').add({
      name: inv.name,
      ...(inv.phoneNumber ? { phoneNumber: inv.phoneNumber } : {}),
      ...(inv.email ? { email: inv.email } : {}),
      recommenderId: inv.inviterId,
      via: inv.via,
      ...(inv.communityId ? { target: { type: 'community', communityId: inv.communityId } } : {}),
      status: inv.memberId ? 'joined' : 'invited',
      ...(inv.memberId ? { resultingMemberId: inv.memberId, joinedAt: minutesAgo(60 * 24) } : {}),
      createdAt: minutesAgo(60 * 24 * 2),
    });
  }

  // 既にログインしたことがある会員は、カスタムクレームにもロールを反映する(次回ログイン時にも設定される)。
  for (const member of MEMBERS) {
    try {
      const user = await admin.auth().getUserByPhoneNumber(member.phoneNumber);
      await admin.auth().setCustomUserClaims(
        user.uid,
        buildMemberClaims(TENANT_ID, member.id, { ...member, createdAt: FieldValue.serverTimestamp() }),
      );
    } catch (err) {
      if ((err as { code?: string }).code !== 'auth/user-not-found') {
        throw err;
      }
    }
  }

  console.log('Seed完了。テスト会員（電話番号でログイン。認証コードは DEVELOPMENT.md の手順で確認）:');
  for (const m of MEMBERS) {
    const roles = [m.membership === 'guest' && 'ゲスト', m.membership === 'community' && '連携コミュニティだけ', m.roles.admin && '管理者', m.roles.recommender && '認定推薦者']
      .filter(Boolean)
      .join('・');
    console.log(`  ${m.phoneNumber}  ${m.displayName}${roles ? `（${roles}）` : ''}`);
  }
  console.log(`  1対1: ${CONNECTIONS.filter((c) => c.status === 'accepted').length}組 / グループ: ${GROUPS.map((g) => g.name).join('、')}`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
