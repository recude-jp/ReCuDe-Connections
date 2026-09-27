import { HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import type { Member, MemberPrivateProfile, ProfileField, ProfileFieldType, ProfileValues } from './models';
import { PROFILE_CONVERTERS, currentYearMonthInJapan, parseYearMonth } from './profileConverters';

/**
 * テナントごとのプロフィール項目(Tenant.profileFields)の検査と、会員が入力した値の検査。
 * 名前(displayName)とプロフィール画像(photoPath)は全テナント共通の固定項目で、ここでは扱わない。
 */

export const PROFILE_FIELD_LIMIT = 30;
const FIELD_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
/** 固定項目・会員ドキュメントの他の項目と紛らわしいため、項目IDに使えない名前。 */
const RESERVED_FIELD_IDS = new Set(['displayName', 'name', 'photo', 'photoPath', 'profile', 'positionLevel', 'roles']);
const LABEL_MAX = 20;
const OPTION_MAX = 30;
const OPTIONS_LIMIT = 50;
export const DISPLAY_NAME_MAX = 30;
const TEXT_MAX = 50;
const TAG_MAX = 30;
const TAGS_LIMIT = 10;
const TYPES: ProfileFieldType[] = ['text', 'select', 'tags', 'yearMonth', 'derived'];
/** 年月の項目で受け付ける年の範囲。 */
const YEAR_MIN = 1900;

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * 管理画面から送られたプロフィール項目の一覧を検査して、保存する形に整える。
 * allowPrivate: 非公開の項目を認めるか(連携コミュニティの項目は、値を会員データに置くため非公開にできない)。
 */
export function sanitizeProfileFields(input: unknown, options: { allowPrivate?: boolean } = {}): ProfileField[] {
  const allowPrivate = options.allowPrivate !== false;
  if (!Array.isArray(input)) {
    throw new HttpsError('invalid-argument', 'プロフィール項目の形式が正しくありません。');
  }
  if (input.length > PROFILE_FIELD_LIMIT) {
    throw new HttpsError('invalid-argument', `プロフィール項目は${PROFILE_FIELD_LIMIT}個までです。`);
  }
  const ids = new Set<string>();
  return input.map((raw, index) => {
    const field = (raw ?? {}) as Partial<ProfileField>;
    const where = `${index + 1}番目の項目`;
    const id = typeof field.id === 'string' ? field.id : '';
    if (!FIELD_ID_PATTERN.test(id) || RESERVED_FIELD_IDS.has(id)) {
      throw new HttpsError('invalid-argument', `${where}のIDが正しくありません。`);
    }
    if (ids.has(id)) {
      throw new HttpsError('invalid-argument', `${where}のIDが重複しています。`);
    }
    ids.add(id);
    const label = trimmedString(field.label);
    if (!label || label.length > LABEL_MAX) {
      throw new HttpsError('invalid-argument', `${where}の項目名は1〜${LABEL_MAX}文字で入力してください。`);
    }
    const type = field.type as ProfileFieldType;
    if (!TYPES.includes(type)) {
      throw new HttpsError('invalid-argument', `「${label}」の入力方法が正しくありません。`);
    }
    const result: ProfileField = { id, label, type };
    if (type === 'select') {
      const options = [...new Set((Array.isArray(field.options) ? field.options : []).map(trimmedString).filter(Boolean))];
      if (options.length === 0) {
        throw new HttpsError('invalid-argument', `「${label}」の選択肢を1つ以上入力してください。`);
      }
      if (options.length > OPTIONS_LIMIT || options.some((o) => o.length > OPTION_MAX)) {
        throw new HttpsError(
          'invalid-argument',
          `「${label}」の選択肢は${OPTIONS_LIMIT}個まで、1つ${OPTION_MAX}文字までです。`,
        );
      }
      result.options = options;
    }
    if (type === 'derived') {
      const converter = PROFILE_CONVERTERS[field.derive?.converter as keyof typeof PROFILE_CONVERTERS];
      if (!converter || typeof field.derive?.source !== 'string') {
        throw new HttpsError('invalid-argument', `「${label}」の自動計算の設定が正しくありません。`);
      }
      result.derive = { converter: converter.id, source: field.derive.source };
    }
    // 自動計算の項目は本人が入力しないため、必須にはできない。
    if (field.required === true && type !== 'derived') {
      result.required = true;
    }
    // 非公開の値は他の会員に見せないため、検索の条件にはできない。
    if (field.private === true && type !== 'derived') {
      if (!allowPrivate) {
        throw new HttpsError('invalid-argument', `「${label}」: 連携コミュニティの項目は非公開にできません。`);
      }
      result.private = true;
    } else if (field.searchable === true && type !== 'yearMonth') {
      result.searchable = true;
    }
    if (field.hidden === true) {
      result.hidden = true;
    }
    return result;
  }).map((field, _i, all) => {
    // 自動計算の変換元は、同じ一覧の、コンバーターが受け付ける入力方法の項目でなければならない。
    if (field.type === 'derived' && field.derive) {
      const source = all.find((f) => f.id === field.derive!.source);
      const converter = PROFILE_CONVERTERS[field.derive.converter];
      if (!source || source.type === 'derived' || !converter.sourceTypes.includes(source.type)) {
        throw new HttpsError('invalid-argument', `「${field.label}」の変換元の項目が正しくありません。`);
      }
    }
    return field;
  });
}

/** 丸いアイコンに出す文字(会員の avatarText・連携コミュニティの logoText)の上限。 */
export const ICON_TEXT_MAX = 2;

/**
 * 丸いアイコンに出す文字を検査する(空白は除く。絵文字など2つの符号で1文字のものも1文字と数える)。
 * 空文字は「未設定に戻す」。src/app/core/utils/icon-text.ts と揃える。
 */
export function sanitizeIconText(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', 'アイコンの文字が正しくありません。');
  }
  const chars = Array.from(value.replace(/\s+/g, ''));
  if (chars.length > ICON_TEXT_MAX) {
    throw new HttpsError('invalid-argument', `アイコンの文字は${ICON_TEXT_MAX}文字までです。`);
  }
  return chars.join('');
}

export function sanitizeDisplayName(value: unknown): string {
  const name = trimmedString(value);
  if (!name) {
    throw new HttpsError('invalid-argument', 'お名前を入力してください。');
  }
  if (name.length > DISPLAY_NAME_MAX) {
    throw new HttpsError('invalid-argument', `お名前は${DISPLAY_NAME_MAX}文字以内で入力してください。`);
  }
  return name;
}

export interface SanitizedProfile {
  /** 会員データ(member.profile)に置く値。自動計算の結果も含む。 */
  publicValues: ProfileValues;
  /** 非公開の値(members/[memberId]/private/profile)。 */
  privateValues: ProfileValues;
}

/**
 * 会員が入力したプロフィールの値を、テナントの項目に照らして検査・整形し、公開・非公開に分ける。
 * 非表示の項目は、入力済みの値(previous)をそのまま残す。項目に無いキーは捨てる。
 * 自動計算の項目は入力を受け付けず、変換元の値から計算する(変換元が未入力なら、前の値を残す)。
 */
export function sanitizeProfileValues(
  fields: ProfileField[],
  input: unknown,
  previous: { publicValues: ProfileValues; privateValues: ProfileValues } = { publicValues: {}, privateValues: {} },
): SanitizedProfile {
  const values = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const publicValues: ProfileValues = {};
  const privateValues: ProfileValues = {};
  const put = (field: ProfileField, value: string | string[]) => {
    (field.private ? privateValues : publicValues)[field.id] = value;
  };
  const now = currentYearMonthInJapan();

  for (const field of fields) {
    if (field.type === 'derived') {
      continue;
    }
    const prev = (field.private ? previous.privateValues : previous.publicValues)[field.id];
    if (field.hidden) {
      if (prev !== undefined) {
        put(field, prev);
      }
      continue;
    }
    const raw = values[field.id];
    if (field.type === 'tags') {
      const tags = [...new Set((Array.isArray(raw) ? raw : []).map(trimmedString).filter(Boolean))];
      if (tags.length > TAGS_LIMIT || tags.some((t) => t.length > TAG_MAX)) {
        throw new HttpsError('invalid-argument', `「${field.label}」は${TAGS_LIMIT}個まで、1つ${TAG_MAX}文字までです。`);
      }
      if (field.required && tags.length === 0) {
        throw new HttpsError('invalid-argument', `「${field.label}」を入力してください。`);
      }
      if (tags.length > 0) {
        put(field, tags);
      }
      continue;
    }
    const value = trimmedString(raw);
    if (field.required && !value) {
      throw new HttpsError('invalid-argument', `「${field.label}」を入力してください。`);
    }
    if (!value) {
      continue;
    }
    if (field.type === 'yearMonth') {
      const ym = parseYearMonth(value);
      if (!ym || ym.year < YEAR_MIN || ym.year * 12 + ym.month > now.year * 12 + now.month) {
        throw new HttpsError('invalid-argument', `「${field.label}」の年月が正しくありません。`);
      }
    }
    if (field.type === 'select' && !(field.options ?? []).includes(value)) {
      throw new HttpsError('invalid-argument', `「${field.label}」は選択肢から選んでください。`);
    }
    if (value.length > TEXT_MAX) {
      throw new HttpsError('invalid-argument', `「${field.label}」は${TEXT_MAX}文字以内で入力してください。`);
    }
    put(field, value);
  }

  applyDerivedValues(fields, publicValues, privateValues, previous.publicValues, now);
  return { publicValues, privateValues };
}

/**
 * 自動計算の項目の値を、変換元の値から計算して publicValues に入れる。
 * 変換元が未入力のときは、前の値(previousPublic。自動計算にする前に選んでいた値など)を残す。
 */
export function applyDerivedValues(
  fields: ProfileField[],
  publicValues: ProfileValues,
  privateValues: ProfileValues,
  previousPublic: ProfileValues,
  now = currentYearMonthInJapan(),
): void {
  for (const field of fields) {
    if (field.type !== 'derived' || !field.derive) {
      continue;
    }
    const source = fields.find((f) => f.id === field.derive!.source);
    const sourceValue = source ? (source.private ? privateValues : publicValues)[source.id] : undefined;
    const converted = PROFILE_CONVERTERS[field.derive.converter]?.convert(sourceValue, now);
    if (converted !== undefined) {
      publicValues[field.id] = converted;
    } else if (previousPublic[field.id] !== undefined) {
      publicValues[field.id] = previousPublic[field.id];
    }
  }
}

export function privateProfilePath(tenantId: string, memberId: string): string {
  return `tenants/${tenantId}/members/${memberId}/private/profile`;
}

/** 会員の非公開のプロフィールの値(無ければ空)。 */
export async function getPrivateValues(tenantId: string, memberId: string): Promise<ProfileValues> {
  const snap = await admin.firestore().doc(privateProfilePath(tenantId, memberId)).get();
  return (snap.data() as MemberPrivateProfile | undefined)?.values ?? {};
}

/** 非公開の値を保存する(空なら何もしない。既存の値を消すときも空で上書きする)。 */
export function writePrivateValues(
  writer: FirebaseFirestore.WriteBatch | FirebaseFirestore.Transaction,
  tenantId: string,
  memberId: string,
  values: ProfileValues,
): void {
  const ref = admin.firestore().doc(privateProfilePath(tenantId, memberId));
  (writer as FirebaseFirestore.WriteBatch).set(ref, { values, updatedAt: FieldValue.serverTimestamp() } satisfies MemberPrivateProfile);
}

/**
 * テナントの会員全員の自動計算の項目を計算し直す(月が変わって年代が上がる人の反映、項目の設定を変えたとき)。
 * 値が変わった会員だけを書き換える。書き換えた人数を返す。
 */
export async function recomputeDerivedValues(tenantId: string): Promise<number> {
  const fields = await getProfileFields(tenantId);
  if (!fields.some((f) => f.type === 'derived')) {
    return 0;
  }
  const db = admin.firestore();
  const now = currentYearMonthInJapan();
  const members = await db.collection(`tenants/${tenantId}/members`).get();
  let changed = 0;
  let batch = db.batch();
  let pending = 0;
  for (const doc of members.docs) {
    const member = doc.data() as Member;
    const publicValues = { ...(member.profile ?? {}) };
    const privateValues = await getPrivateValues(tenantId, doc.id);
    applyDerivedValues(fields, publicValues, privateValues, member.profile ?? {}, now);
    if (JSON.stringify(publicValues) !== JSON.stringify(member.profile ?? {})) {
      batch.update(doc.ref, { profile: publicValues });
      changed++;
      if (++pending >= 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
  }
  if (pending > 0) {
    await batch.commit();
  }
  return changed;
}

/**
 * 自由入力・複数入力の値を、テナントの入力候補(profileOptions/[項目ID]/values)に蓄積する
 * (完全一致のみ。表記ゆれの名寄せは管理 A4)。
 */
export async function upsertProfileOptions(
  tenantId: string,
  fields: ProfileField[],
  profile: ProfileValues,
  /** 入力候補の分類の頭に付ける文字(連携コミュニティの項目は profileOptionCategory で区別する)。 */
  categoryOf: (field: ProfileField) => string = (field) => field.id,
): Promise<void> {
  const db = admin.firestore();
  const writes: Promise<unknown>[] = [];
  for (const field of fields) {
    // 候補に貯めるのは、自由入力・複数入力の公開の項目だけ(非公開の値を他の会員の入力候補に出さないため)。
    if ((field.type !== 'text' && field.type !== 'tags') || field.hidden || field.private) {
      continue;
    }
    const value = profile[field.id];
    for (const label of Array.isArray(value) ? value : value ? [value] : []) {
      writes.push(
        db
          .doc(`tenants/${tenantId}/profileOptions/${categoryOf(field)}/values/${encodeURIComponent(label)}`)
          .set({ label, createdAt: FieldValue.serverTimestamp() }, { merge: true }),
      );
    }
  }
  await Promise.all(writes);
}

/** テナントのプロフィール項目(未設定なら空)。 */
export async function getProfileFields(tenantId: string): Promise<ProfileField[]> {
  const snap = await admin.firestore().doc(`tenants/${tenantId}`).get();
  return (snap.data()?.['profileFields'] as ProfileField[] | undefined) ?? [];
}

/**
 * 入力候補の分類(profileOptions/[分類])。ルートの項目は項目ID、連携コミュニティの項目は「c_連携コミュニティのID_項目ID」
 * (同じ項目IDでも、連携コミュニティごとに候補を分ける)。src/app/core/utils/profile-fields.ts と揃える。
 */
export function profileOptionCategory(fieldId: string, communityId?: string): string {
  return communityId ? `c_${communityId}_${fieldId}` : fieldId;
}

/**
 * 連携コミュニティのメンバーの自動計算の項目を計算し直す(連携コミュニティの項目は非公開にできないため、公開の値だけで計算する)。
 * 値が変わった会員だけを書き換える。書き換えた人数を返す。
 */
export async function recomputeCommunityDerivedValues(
  tenantId: string,
  communityId: string,
  fields: ProfileField[],
): Promise<number> {
  if (!fields.some((f) => f.type === 'derived')) {
    return 0;
  }
  const db = admin.firestore();
  const now = currentYearMonthInJapan();
  const members = await db
    .collection(`tenants/${tenantId}/members`)
    .where('communityIds', 'array-contains', communityId)
    .get();
  let changed = 0;
  const batch = db.batch();
  for (const doc of members.docs) {
    const current = (doc.data() as Member).communityProfiles?.[communityId] ?? {};
    const values = { ...current };
    applyDerivedValues(fields, values, {}, current, now);
    if (JSON.stringify(values) !== JSON.stringify(current)) {
      batch.update(doc.ref, { [`communityProfiles.${communityId}`]: values });
      changed++;
    }
  }
  if (changed > 0) {
    await batch.commit();
  }
  return changed;
}
