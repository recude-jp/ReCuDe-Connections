/**
 * プロフィールのコンバーター(自動計算の項目の変換処理)の登録簿。
 * src/app/core/utils/profile-converters.ts と内容を揃えて保守する(画面のプレビュー・検索の選択肢にも使うため)。
 *
 * コンバーターを増やすときは、ここに1つ登録する(例: 入会年月から在籍年数、卒業年から学年)。
 */
import type { ProfileConverterId, ProfileFieldType } from './models';

export interface ProfileConverter {
  id: ProfileConverterId;
  /** 管理画面に出す名前。 */
  label: string;
  /** 変換元にできる項目の入力方法。 */
  sourceTypes: ProfileFieldType[];
  /** 変換した結果の候補(会員検索の選択肢に使う)。 */
  outputs: string[];
  /** 変換する。変換元が未入力・不正なら undefined。now は日本時間の年・月。 */
  convert(source: string | string[] | undefined, now: { year: number; month: number }): string | undefined;
}

/** "YYYY-MM" を年・月に分ける。形式が違えば null。 */
export function parseYearMonth(value: unknown): { year: number; month: number } | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? { year, month } : null;
}

/**
 * 生年月から満年齢を出す。日がわからないため、生まれた月の翌月からその年齢になったものとして数える
 * (生まれた月のうちは、まだ誕生日が来ていないかもしれないため)。
 */
export function ageFromBirthYearMonth(birth: { year: number; month: number }, now: { year: number; month: number }): number {
  const months = now.year * 12 + now.month - (birth.year * 12 + birth.month);
  return Math.floor((months - 1) / 12);
}

const AGE_GROUP_TOP = 60;

export const PROFILE_CONVERTERS: Record<ProfileConverterId, ProfileConverter> = {
  ageGroup: {
    id: 'ageGroup',
    label: '年代（年月から。生年月の翌月から切り替え）',
    sourceTypes: ['yearMonth'],
    outputs: ['10代', '20代', '30代', '40代', '50代', `${AGE_GROUP_TOP}代以上`],
    convert(source, now) {
      const birth = parseYearMonth(source);
      if (!birth) {
        return undefined;
      }
      const age = ageFromBirthYearMonth(birth, now);
      if (age < 0) {
        return undefined;
      }
      if (age >= AGE_GROUP_TOP) {
        return `${AGE_GROUP_TOP}代以上`;
      }
      return `${Math.max(10, Math.floor(age / 10) * 10)}代`;
    },
  },
};

/** 日本時間の今の年・月(月の切り替わりを日本時間で数えるため)。 */
export function currentYearMonthInJapan(date = new Date()): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric' }).formatToParts(date);
  return {
    year: Number(parts.find((p) => p.type === 'year')?.value),
    month: Number(parts.find((p) => p.type === 'month')?.value),
  };
}
