/** 丸いアイコンに出す文字(会員の avatarText・連携コミュニティの logoText)の上限。functions/src/profile.ts と揃える。 */
export const ICON_TEXT_MAX = 2;

/** 文字を数える単位に分ける(空白は除く。絵文字など2つの符号で1文字のものも1文字と数える)。 */
export function iconChars(value: string | null | undefined): string[] {
  return Array.from((value ?? '').replace(/\s+/g, ''));
}

/** 入力されたアイコンの文字を、上限までに切り詰める(入力欄で使う)。 */
export function clampIconText(value: string): string {
  return iconChars(value).slice(0, ICON_TEXT_MAX).join('');
}
