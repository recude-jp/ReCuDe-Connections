import type { ProfileField, ProfileFieldType, ProfileValues } from '../models/firestore.models';
import { PROFILE_CONVERTERS, currentYearMonthInJapan, parseYearMonth } from './profile-converters';

/**
 * テナントごとのプロフィール項目(Tenant.profileFields)の扱い。
 * 名前とプロフィール画像は全テナント共通の固定項目で、ここでは扱わない。
 * 値の検査はサーバー側(functions/src/profile.ts)と揃えること。
 */

export const PROFILE_FIELD_TYPE_LABELS: Record<ProfileFieldType, string> = {
  text: '自由入力（入力候補あり）',
  select: '選択式（1つ選ぶ）',
  tags: '複数入力（例: 趣味）',
  yearMonth: '年月（年と月だけ。例: 生年月）',
  derived: '自動計算（コンバーターで別の項目から決める）',
};

/** 入力・表示する項目(非表示の項目を除く)。 */
export function visibleProfileFields(fields: ProfileField[] | undefined): ProfileField[] {
  return (fields ?? []).filter((field) => !field.hidden);
}

/** 表示用の文字列(複数入力は「、」でつなぐ。年月は「1996年5月」)。未入力は空文字。 */
export function formatProfileValue(value: string | string[] | undefined, field?: ProfileField): string {
  if (Array.isArray(value)) {
    return value.join('、');
  }
  if (field?.type === 'yearMonth') {
    const ym = parseYearMonth(value);
    return ym ? `${ym.year}年${ym.month}月` : (value ?? '');
  }
  return value ?? '';
}

/**
 * 自動計算の項目の値を、入力中の値から計算する(画面のプレビュー用。保存する値はサーバーが決める)。
 * 変換元が未入力なら fallback(保存済みの値)を返す。
 */
export function previewDerivedValue(field: ProfileField, fields: ProfileField[], values: ProfileValues, fallback?: string | string[]): string {
  if (field.type !== 'derived' || !field.derive) {
    return '';
  }
  const source = fields.find((f) => f.id === field.derive!.source);
  const converted = PROFILE_CONVERTERS[field.derive.converter]?.convert(source ? values[source.id] : undefined, currentYearMonthInJapan());
  return converted ?? formatProfileValue(fallback);
}

/** 会員検索の選択肢(選択式は選択肢、自動計算はコンバーターの結果の候補)。自由入力・複数入力は null(入力候補を使う)。 */
export function fixedSearchOptions(field: ProfileField): string[] | null {
  if (field.type === 'select') {
    return field.options ?? [];
  }
  if (field.type === 'derived' && field.derive) {
    return PROFILE_CONVERTERS[field.derive.converter]?.outputs ?? [];
  }
  return null;
}

/** 一覧などに出す短い要約(入力されている項目の値を、項目の順に max 個まで)。 */
export function profileSummary(profile: ProfileValues | undefined, fields: ProfileField[] | undefined, max = 3): string {
  return visibleProfileFields(fields)
    .filter((field) => !field.private)
    .map((field) => formatProfileValue(profile?.[field.id], field))
    .filter(Boolean)
    .slice(0, max)
    .join('・');
}

/** 必須なのに未入力の項目名。 */
export function missingRequiredFields(fields: ProfileField[], values: ProfileValues): string[] {
  return fields
    .filter((field) => field.required && !field.hidden && field.type !== 'derived')
    .filter((field) => {
      const value = values[field.id];
      return Array.isArray(value) ? value.length === 0 : !value?.trim();
    })
    .map((field) => field.label);
}

/**
 * 入力候補の分類(profileOptions/[分類])。ルートの項目は項目ID、連携コミュニティの項目は「c_連携コミュニティのID_項目ID」。
 * functions/src/profile.ts の profileOptionCategory と揃える。
 */
export function profileOptionCategory(fieldId: string, communityId?: string): string {
  return communityId ? `c_${communityId}_${fieldId}` : fieldId;
}
