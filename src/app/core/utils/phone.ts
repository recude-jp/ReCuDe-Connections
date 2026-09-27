/**
 * 日本の携帯番号(先頭0)をE.164形式(+81)に変換する。すでに+付きならそのまま(区切りだけ除いて)返す。
 * ハイフン・空白・括弧などの区切りは取り除き、全角の数字・記号は半角にする(例: 「０９０−１２３４−５６７８」)。
 * 電話番号の索引(phoneIndex)は区切りのないE.164形式で持つため、区切りが残ると会員が見つからない。
 */
export function toE164(input: string): string {
  const normalized = input.normalize('NFKC').replace(/[^\d+]/g, '');
  if (normalized.startsWith('+')) {
    return `+${normalized.slice(1).replace(/\+/g, '')}`;
  }
  const digits = normalized.replace(/\+/g, '');
  return digits.startsWith('0') ? `+81${digits.slice(1)}` : `+81${digits}`;
}
