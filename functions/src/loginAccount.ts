import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Transaction } from 'firebase-admin/firestore';
import { createHash, createHmac, randomBytes, randomInt } from 'crypto';
import { hashSecret, verifySecret } from './hash';
import { sendSms } from './twilio';
import { mailSecrets, messagingSecrets, sendEmail } from './mail';
import { buildMemberClaims } from './memberClaims';
import { MemberRef, requireCallerIdentity } from './callerIdentity';
import { getMemberPhone, loginSettingsPath } from './memberPrivate';
import { credentialsCollectionPath } from './webauthn';

export { loginSettingsPath } from './memberPrivate';
import type {
  EmailVerification,
  LoginCode,
  LoginIdIndexEntry,
  Member,
  MemberLoginSettings,
  PhoneIndexEntry,
  Tenant,
} from './models';

/**
 * ログインID・メールアドレスと、メール・SMSの認証コードによるログイン(SPEC 1章「ログイン方式の変更」)。
 *
 * 登録されていないIDの存在を伏せるため、未登録のIDにもIDごとに決まったダミーの送り先を返し、
 * 「送信しました」と応える(実際には送らない)。送信回数の制限・認証コードの判定も、登録されているIDと同じ流れにする。
 */

export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
const HOUR_MS = 60 * 60 * 1000;
/** 同じIDへの送信の間隔と、1時間あたりの上限。 */
const SEND_INTERVAL_MS = 60 * 1000;
export const SENDS_PER_HOUR = 5;
/** 同じ接続元(IPアドレス)からの、1時間あたりの送信の上限(IDを変えながらの大量送信を防ぐ)。 */
const SENDS_PER_HOUR_PER_IP = 30;

const LOGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{3,29}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX = 254;

const db = () => admin.firestore();

export type LoginChannel = 'email' | 'sms';

export interface LoginChannels {
  email: boolean;
  sms: boolean;
}

/** 入力されたID。key は索引の検索に使う形(小文字・E.164)。 */
type LoginIdentifier =
  | { kind: 'loginId'; key: string }
  | { kind: 'email'; key: string }
  | { kind: 'phone'; key: string };

interface ResolvedMember {
  ref: MemberRef;
  member: Member;
  settings: Partial<MemberLoginSettings>;
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

/** 日本の電話番号(先頭0)をE.164形式にする(クライアントの toE164 と同じ規則)。 */
function toE164(input: string): string {
  const normalized = input.normalize('NFKC').replace(/[^\d+]/g, '');
  if (normalized.startsWith('+')) {
    return `+${normalized.slice(1).replace(/\+/g, '')}`;
  }
  const digits = normalized.replace(/\+/g, '');
  return digits.startsWith('0') ? `+81${digits.slice(1)}` : `+81${digits}`;
}

/**
 * ログインIDを検査し、小文字に揃えて返す。半角の英小文字・数字・「.」「_」「-」で4〜30文字、
 * 英字を1文字以上含む(数字だけだと電話番号と区別できないため)。
 */
export function sanitizeLoginId(value: unknown): string {
  const loginId = typeof value === 'string' ? normalize(value) : '';
  if (!loginId) {
    throw new HttpsError('invalid-argument', 'ログインIDを入力してください。');
  }
  if (!LOGIN_ID_PATTERN.test(loginId) || !/[a-z]/.test(loginId)) {
    throw new HttpsError(
      'invalid-argument',
      'ログインIDは、半角の英字・数字・「.」「_」「-」で4〜30文字にしてください（英字を1文字以上含めてください）。',
    );
  }
  return loginId;
}

function sanitizeEmail(value: unknown): string {
  const email = typeof value === 'string' ? normalize(value) : '';
  if (!email || email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email)) {
    throw new HttpsError('invalid-argument', 'メールアドレスの形式が正しくありません。');
  }
  return email;
}

function parseIdentifier(value: unknown): LoginIdentifier {
  const raw = typeof value === 'string' ? normalize(value) : '';
  if (!raw) {
    throw new HttpsError('invalid-argument', 'ログインIDを入力してください。');
  }
  if (raw.includes('@')) {
    return { kind: 'email', key: sanitizeEmail(raw) };
  }
  // ログインIDが未設定の既存の会員は、電話番号でログインする(ログインIDは英字を必ず含むため重ならない)。
  if (/^[+\d\s()-]+$/.test(raw) && raw.replace(/\D/g, '').length >= 10) {
    return { kind: 'phone', key: toE164(raw) };
  }
  if (!LOGIN_ID_PATTERN.test(raw) || !/[a-z]/.test(raw)) {
    throw new HttpsError('invalid-argument', 'ログインIDの形式が正しくありません。');
  }
  return { kind: 'loginId', key: raw };
}

/** IDから有効な会員を探す。見つからない・無効になっているときは null(存在を伏せるため、区別しない)。 */
async function resolveMember(identifier: LoginIdentifier): Promise<ResolvedMember | null> {
  let ref: MemberRef | null = null;
  if (identifier.kind === 'phone') {
    const entry = (await db().doc(`phoneIndex/${identifier.key}`).get()).data() as PhoneIndexEntry | undefined;
    ref = entry ? { tenantId: entry.tenantId, memberId: entry.memberId } : null;
  } else {
    const entry = (await db().doc(`loginIdIndex/${identifier.key}`).get()).data() as LoginIdIndexEntry | undefined;
    ref = entry && entry.kind === identifier.kind ? { tenantId: entry.tenantId, memberId: entry.memberId } : null;
  }
  if (!ref) {
    return null;
  }
  const [memberSnap, settingsSnap] = await Promise.all([
    db().doc(`tenants/${ref.tenantId}/members/${ref.memberId}`).get(),
    db().doc(loginSettingsPath(ref)).get(),
  ]);
  const member = memberSnap.data() as Member | undefined;
  if (!member || !member.isActive) {
    return null;
  }
  return { ref, member, settings: (settingsSnap.data() ?? {}) as Partial<MemberLoginSettings> };
}

function phoneOf(resolved: ResolvedMember): string | undefined {
  return resolved.settings.phoneNumber ?? resolved.member.phoneNumber;
}

function channelsOf(resolved: ResolvedMember): LoginChannels {
  return { email: !!resolved.settings.email, sms: !!phoneOf(resolved) };
}

let decoyKeyCache: string | null = null;

/** ダミーの送り先を決める秘密の値。初めて使うときに作って Firestore(クライアントからは読めない)に置く。 */
async function getDecoyKey(): Promise<string> {
  if (decoyKeyCache) {
    return decoyKeyCache;
  }
  const ref = db().doc('systemSecrets/login');
  const existing = (await ref.get()).data() as { decoyKey?: string } | undefined;
  if (existing?.decoyKey) {
    decoyKeyCache = existing.decoyKey;
    return decoyKeyCache;
  }
  const decoyKey = randomBytes(32).toString('hex');
  try {
    await ref.create({ decoyKey });
    decoyKeyCache = decoyKey;
  } catch {
    // 同時に作られたときは、先に作られた値を使う。
    decoyKeyCache = ((await ref.get()).data() as { decoyKey: string }).decoyKey;
  }
  return decoyKeyCache;
}

/**
 * 登録されていないIDに見せる送り先。会員は電話番号が必須のため、本物と同じく「SMSのみ」か「メールとSMS」にする。
 * IDごとに決まるので、同じIDを何度入れても同じアイコンが出る。
 */
async function decoyChannels(identifier: LoginIdentifier): Promise<LoginChannels> {
  const digest = createHmac('sha256', await getDecoyKey()).update(`${identifier.kind}:${identifier.key}`).digest();
  return { email: digest[0] < 77, sms: true };
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** 直近1時間の送信時刻を数え、制限を超えていればエラーにする。今回の送信を加えた一覧を返す。 */
export function nextSentAt(sentAt: Timestamp[] | undefined, perHour: number, now: number): Timestamp[] {
  const recent = (sentAt ?? []).filter((t) => t.toMillis() > now - HOUR_MS);
  const last = recent.length > 0 ? recent[recent.length - 1].toMillis() : 0;
  if (now - last < SEND_INTERVAL_MS) {
    throw new HttpsError('resource-exhausted', '続けて送信できません。1分ほど待ってから、もう一度お試しください。');
  }
  if (recent.length >= perHour) {
    throw new HttpsError('resource-exhausted', '送信の回数が上限に達しました。しばらく時間をおいてから、もう一度お試しください。');
  }
  return [...recent, Timestamp.fromMillis(now)];
}

/** 接続元ごとの送信回数を数える(IPアドレスはハッシュにして保存する)。 */
export async function countSendFromIp(tx: Transaction, request: CallableRequest, now: number): Promise<void> {
  const ip = request.rawRequest?.ip;
  if (!ip) {
    return;
  }
  const ref = db().doc(`loginRateLimits/${sha256(`ip:${ip}`)}`);
  const data = (await tx.get(ref)).data() as { sentAt?: Timestamp[] } | undefined;
  const recent = (data?.sentAt ?? []).filter((t) => t.toMillis() > now - HOUR_MS);
  if (recent.length >= SENDS_PER_HOUR_PER_IP) {
    throw new HttpsError('resource-exhausted', '送信の回数が上限に達しました。しばらく時間をおいてから、もう一度お試しください。');
  }
  tx.set(ref, { sentAt: [...recent, Timestamp.fromMillis(now)] });
}

export async function serviceNameOf(tenantId: string): Promise<string> {
  const tenant = (await db().doc(`tenants/${tenantId}`).get()).data() as Tenant | undefined;
  return tenant?.branding?.siteTitle || tenant?.name || 'ReCuDe Connections';
}

/** Firebase Auth のユーザー(電話番号でログインしたときと同じユーザー)。無ければ作る。 */
export async function authUidForPhone(phoneNumber: string): Promise<string> {
  try {
    return (await admin.auth().getUserByPhoneNumber(phoneNumber)).uid;
  } catch (err) {
    if ((err as { code?: string }).code !== 'auth/user-not-found') {
      throw err;
    }
    return (await admin.auth().createUser({ phoneNumber })).uid;
  }
}

/**
 * ログインの最初のステップ。入力したIDの認証コードの送り先(メール・SMS)を返す。未ログイン状態から呼べる。
 * 登録されていないIDには、ダミーの送り先を返す。
 */
export const startLogin = onCall(async (request) => {
  const identifier = parseIdentifier((request.data ?? {}).identifier);
  const resolved = await resolveMember(identifier);
  const channels = resolved ? channelsOf(resolved) : await decoyChannels(identifier);
  return { channels };
});

/** 選んだ送り先に、ログインの認証コードを送る。登録されていないIDでは、送らずに同じ応答を返す。 */
export const sendLoginCode = onCall({ secrets: messagingSecrets }, async (request) => {
  const { identifier: rawIdentifier, channel } = (request.data ?? {}) as { identifier?: unknown; channel?: unknown };
  const identifier = parseIdentifier(rawIdentifier);
  if (channel !== 'email' && channel !== 'sms') {
    throw new HttpsError('invalid-argument', '送り先を選んでください。');
  }

  const resolved = await resolveMember(identifier);
  const deliverTo = resolved && channelsOf(resolved)[channel] ? resolved : null;
  const code = deliverTo ? generateCode() : null;
  const codeHash = code ? await hashSecret(code) : undefined;

  const now = Date.now();
  const codeRef = db().doc(`loginCodes/${sha256(`${identifier.kind}:${identifier.key}`)}`);
  await db().runTransaction(async (tx) => {
    const existing = (await tx.get(codeRef)).data() as LoginCode | undefined;
    const sentAt = nextSentAt(existing?.sentAt, SENDS_PER_HOUR, now);
    await countSendFromIp(tx, request, now);
    const next: LoginCode = {
      ...(deliverTo && codeHash
        ? { tenantId: deliverTo.ref.tenantId, memberId: deliverTo.ref.memberId, channel, codeHash }
        : {}),
      // 期限切れの扱いも本物と同じにするため、送らなかったときも期限を持たせる。
      expiresAt: Timestamp.fromMillis(now + CODE_TTL_MS),
      failedAttempts: 0,
      sentAt,
    };
    tx.set(codeRef, next);
  });

  if (deliverTo && code) {
    const serviceName = await serviceNameOf(deliverTo.ref.tenantId);
    try {
      if (channel === 'sms') {
        await sendSms(phoneOf(deliverTo)!, `【${serviceName}】ログインの認証コード: ${code}（10分間有効）`);
      } else {
        await sendEmail(
          deliverTo.settings.email!,
          `【${serviceName}】ログインの認証コード`,
          `ログインの認証コードは ${code} です。\n10分以内に入力してください。\n\nお心当たりがない場合は、このメールを破棄してください。`,
        );
      }
    } catch (err) {
      logger.error('ログインの認証コードの送信に失敗しました', err);
      throw new HttpsError('internal', '認証コードを送信できませんでした。時間をおいて、もう一度お試しください。');
    }
  }
  return { sent: true };
});

type CodeOutcome =
  | { status: 'expired' }
  | { status: 'locked' }
  | { status: 'invalid' }
  | { status: 'success'; tenantId: string; memberId: string };

/**
 * 認証コードを確かめ、合っていればFirebase Authのカスタムトークンを返す。
 * 判定と失敗回数の更新はトランザクション内で行い、エラーはトランザクションの外で投げる
 * (中で投げると失敗回数の更新が取り消されるため。pinSignIn と同じ)。
 */
export const verifyLoginCode = onCall({ concurrency: 1 }, async (request) => {
  const { identifier: rawIdentifier, code } = (request.data ?? {}) as { identifier?: unknown; code?: unknown };
  const identifier = parseIdentifier(rawIdentifier);
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    throw new HttpsError('invalid-argument', '6桁の認証コードを入力してください。');
  }

  const codeRef = db().doc(`loginCodes/${sha256(`${identifier.kind}:${identifier.key}`)}`);
  const outcome: CodeOutcome = await db().runTransaction(async (tx) => {
    const data = (await tx.get(codeRef)).data() as LoginCode | undefined;
    if (!data?.expiresAt || data.expiresAt.toMillis() < Date.now()) {
      return { status: 'expired' };
    }
    if (data.failedAttempts >= CODE_MAX_ATTEMPTS) {
      return { status: 'locked' };
    }
    const verified = !!data.codeHash && (await verifySecret(code, data.codeHash));
    if (!verified || !data.tenantId || !data.memberId) {
      const failedAttempts = data.failedAttempts + 1;
      tx.update(codeRef, { failedAttempts });
      return { status: failedAttempts >= CODE_MAX_ATTEMPTS ? 'locked' : 'invalid' };
    }
    // 送信回数の記録(sentAt)は残し、使った認証コードだけを消す。
    tx.update(codeRef, {
      codeHash: FieldValue.delete(),
      expiresAt: FieldValue.delete(),
      tenantId: FieldValue.delete(),
      memberId: FieldValue.delete(),
      channel: FieldValue.delete(),
      failedAttempts: 0,
    });
    return { status: 'success', tenantId: data.tenantId, memberId: data.memberId };
  });

  if (outcome.status === 'expired') {
    throw new HttpsError('deadline-exceeded', '認証コードの有効期限が切れました。もう一度送信してください。');
  }
  if (outcome.status === 'locked') {
    throw new HttpsError('resource-exhausted', '認証コードの入力の回数が上限に達しました。もう一度送信してください。');
  }
  if (outcome.status === 'invalid') {
    throw new HttpsError('permission-denied', '認証コードが正しくありません。ご確認のうえ再度入力してください。');
  }

  const ref: MemberRef = { tenantId: outcome.tenantId, memberId: outcome.memberId };
  const [memberSnap, settingsSnap, passkeySnap] = await Promise.all([
    db().doc(`tenants/${ref.tenantId}/members/${ref.memberId}`).get(),
    db().doc(loginSettingsPath(ref)).get(),
    db().collection(credentialsCollectionPath(ref)).limit(1).get(),
  ]);
  const member = memberSnap.data() as Member | undefined;
  if (!member || !member.isActive) {
    throw new HttpsError('permission-denied', 'このアカウントは現在無効になっています。');
  }
  const settings = (settingsSnap.data() ?? {}) as Partial<MemberLoginSettings>;

  const phoneNumber = await getMemberPhone(ref, member, settings);
  if (!phoneNumber) {
    throw new HttpsError('failed-precondition', 'このアカウントには電話番号が登録されていません。事務局にお問い合わせください。');
  }
  const uid = await authUidForPhone(phoneNumber);
  await admin.auth().setCustomUserClaims(uid, buildMemberClaims(ref.tenantId, ref.memberId, member));
  const customToken = await admin.auth().createCustomToken(uid);
  // hasPasskey: パスキーを登録済みか(ログイン画面で、毎回パスキーの登録を勧めないために使う)。
  return { customToken, needsLoginId: !settings.loginId, hasPasskey: !passkeySnap.empty };
});

/** パスキーでログインしたとき、そのパスキーが入力したIDの会員のものかを確かめる。 */
export async function identifierMatchesMember(rawIdentifier: unknown, ref: MemberRef): Promise<boolean> {
  const identifier = parseIdentifier(rawIdentifier);
  const resolved = await resolveMember(identifier);
  return !!resolved && resolved.ref.tenantId === ref.tenantId && resolved.ref.memberId === ref.memberId;
}

// ---- ログイン中の会員が、ログインID・メールアドレスを設定する(マイページの「ログイン設定」) ----

/** 自分のログインの設定(ログインID・メールアドレス)。 */
export const getLoginSettings = onCall(async (request) => {
  const identity = requireCallerIdentity(request.auth);
  const settings = ((await db().doc(loginSettingsPath(identity)).get()).data() ?? {}) as Partial<MemberLoginSettings>;
  return {
    loginId: settings.loginId ?? null,
    email: settings.email ?? null,
    emailLogin: settings.emailLogin === true,
  };
});

function alreadyUsed(kind: 'loginId' | 'email'): HttpsError {
  return new HttpsError(
    'already-exists',
    kind === 'loginId'
      ? 'このログインIDはすでに使われています。別のIDにしてください。'
      : 'このメールアドレスは、ほかのアカウントでログインIDとして使われています。',
  );
}

/** 索引を自分のものとして置く。ほかの会員が使っていればエラーにする。 */
async function claimIndex(tx: Transaction, key: string, kind: 'loginId' | 'email', ref: MemberRef): Promise<void> {
  const indexRef = db().doc(`loginIdIndex/${key}`);
  const entry = (await tx.get(indexRef)).data() as LoginIdIndexEntry | undefined;
  if (entry && (entry.tenantId !== ref.tenantId || entry.memberId !== ref.memberId)) {
    throw alreadyUsed(kind);
  }
  tx.set(indexRef, { tenantId: ref.tenantId, memberId: ref.memberId, kind } satisfies LoginIdIndexEntry);
}

/** ログインIDを設定する(変えると、前のIDではログインできなくなる)。 */
export const setLoginId = onCall(async (request) => {
  const identity = requireCallerIdentity(request.auth);
  const loginId = sanitizeLoginId((request.data ?? {}).loginId);
  const settingsRef = db().doc(loginSettingsPath(identity));

  await db().runTransaction(async (tx) => {
    const settings = ((await tx.get(settingsRef)).data() ?? {}) as Partial<MemberLoginSettings>;
    if (settings.loginId === loginId) {
      return;
    }
    await claimIndex(tx, loginId, 'loginId', identity);
    if (settings.loginId) {
      tx.delete(db().doc(`loginIdIndex/${settings.loginId}`));
    }
    tx.set(settingsRef, { loginId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  return { loginId };
});

function emailVerificationRef(ref: MemberRef) {
  return db().doc(`emailVerifications/${ref.tenantId}_${ref.memberId}`);
}

/** メールアドレスを登録するため、そのアドレスに確認コードを送る。 */
export const startEmailRegistration = onCall({ secrets: mailSecrets }, async (request) => {
  const identity = requireCallerIdentity(request.auth);
  const email = sanitizeEmail((request.data ?? {}).email);
  const code = generateCode();
  const codeHash = await hashSecret(code);
  const now = Date.now();
  const ref = emailVerificationRef(identity);

  await db().runTransaction(async (tx) => {
    const existing = (await tx.get(ref)).data() as EmailVerification | undefined;
    const sentAt = nextSentAt(existing?.sentAt, SENDS_PER_HOUR, now);
    tx.set(ref, {
      email,
      codeHash,
      expiresAt: Timestamp.fromMillis(now + CODE_TTL_MS),
      failedAttempts: 0,
      sentAt,
    } satisfies EmailVerification);
  });

  const serviceName = await serviceNameOf(identity.tenantId);
  await sendEmail(
    email,
    `【${serviceName}】メールアドレスの確認`,
    `メールアドレスの確認コードは ${code} です。\n10分以内に、アプリの画面で入力してください。\n\nお心当たりがない場合は、このメールを破棄してください。`,
  );
  return { sent: true };
});

/** 確認コードを確かめてメールアドレスを登録する。useAsLoginId なら、ログインIDの代わりに使えるようにする。 */
export const confirmEmailRegistration = onCall({ concurrency: 1 }, async (request) => {
  const identity = requireCallerIdentity(request.auth);
  const { code, useAsLoginId } = (request.data ?? {}) as { code?: unknown; useAsLoginId?: unknown };
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    throw new HttpsError('invalid-argument', '6桁の確認コードを入力してください。');
  }
  const ref = emailVerificationRef(identity);

  const outcome = await db().runTransaction(async (tx): Promise<{ status: CodeOutcome['status']; email?: string }> => {
    const data = (await tx.get(ref)).data() as EmailVerification | undefined;
    if (!data || data.expiresAt.toMillis() < Date.now()) {
      return { status: 'expired' };
    }
    if (data.failedAttempts >= CODE_MAX_ATTEMPTS) {
      return { status: 'locked' };
    }
    if (!(await verifySecret(code, data.codeHash))) {
      const failedAttempts = data.failedAttempts + 1;
      tx.update(ref, { failedAttempts });
      return { status: failedAttempts >= CODE_MAX_ATTEMPTS ? 'locked' : 'invalid' };
    }
    return { status: 'success', email: data.email };
  });

  if (outcome.status === 'expired') {
    throw new HttpsError('deadline-exceeded', '確認コードの有効期限が切れました。もう一度送信してください。');
  }
  if (outcome.status === 'locked') {
    throw new HttpsError('resource-exhausted', '確認コードの入力の回数が上限に達しました。もう一度送信してください。');
  }
  if (outcome.status === 'invalid' || !outcome.email) {
    throw new HttpsError('permission-denied', '確認コードが正しくありません。ご確認のうえ再度入力してください。');
  }

  const email = outcome.email;
  const settingsRef = db().doc(loginSettingsPath(identity));
  await db().runTransaction(async (tx) => {
    const settings = ((await tx.get(settingsRef)).data() ?? {}) as Partial<MemberLoginSettings>;
    if (useAsLoginId === true) {
      await claimIndex(tx, email, 'email', identity);
    }
    if (settings.emailLogin && settings.email && (settings.email !== email || useAsLoginId !== true)) {
      tx.delete(db().doc(`loginIdIndex/${settings.email}`));
    }
    tx.set(
      settingsRef,
      { email, emailLogin: useAsLoginId === true, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    tx.delete(ref);
  });
  return { email, emailLogin: useAsLoginId === true };
});

/** 登録済みのメールアドレスを、ログインIDの代わりに使えるようにする(または、やめる)。 */
export const setEmailLogin = onCall(async (request) => {
  const identity = requireCallerIdentity(request.auth);
  const enabled = (request.data ?? {}).enabled === true;
  const settingsRef = db().doc(loginSettingsPath(identity));

  await db().runTransaction(async (tx) => {
    const settings = ((await tx.get(settingsRef)).data() ?? {}) as Partial<MemberLoginSettings>;
    if (!settings.email) {
      throw new HttpsError('failed-precondition', '先にメールアドレスを登録してください。');
    }
    if (enabled) {
      await claimIndex(tx, settings.email, 'email', identity);
    } else if (settings.emailLogin) {
      tx.delete(db().doc(`loginIdIndex/${settings.email}`));
    }
    tx.set(settingsRef, { emailLogin: enabled, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  return { emailLogin: enabled };
});

/** 登録済みのメールアドレスを外す(ログインIDとして使っていれば、それもやめる)。 */
export const removeEmail = onCall(async (request) => {
  const identity = requireCallerIdentity(request.auth);
  const settingsRef = db().doc(loginSettingsPath(identity));

  await db().runTransaction(async (tx) => {
    const settings = ((await tx.get(settingsRef)).data() ?? {}) as Partial<MemberLoginSettings>;
    if (settings.emailLogin && settings.email) {
      tx.delete(db().doc(`loginIdIndex/${settings.email}`));
    }
    tx.set(
      settingsRef,
      { email: FieldValue.delete(), emailLogin: false, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  });
  return { removed: true };
});
