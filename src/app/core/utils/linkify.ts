/** メッセージの文の一部。url があれば、その部分はリンクにする。 */
export interface TextSegment {
  text: string;
  url?: string;
}

/**
 * http(s) の URL として使える文字だけを拾う(日本語は URL に続けて書かれることが多いため、URL の一部にしない)。
 * 末尾の句読点・閉じかっこは、文の一部とみなして外す(TRAILING)。
 */
const URL_PATTERN = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/g;
const TRAILING = ".,;:!?'\")]";

/**
 * 文を、普通の文字と URL に分ける。画面では URL の部分だけを <a> にする
 * (innerHTML を使わないため、メッセージの文に HTML が入っていても、そのまま文字として出る)。
 */
export function linkify(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = trimTrailing(match[0]);
    if (url.replace(/^https?:\/\//, '') === '') {
      continue;
    }
    const start = match.index;
    if (start > last) {
      segments.push({ text: text.slice(last, start) });
    }
    segments.push({ text: url, url });
    last = start + url.length;
  }
  if (last < text.length) {
    segments.push({ text: text.slice(last) });
  }
  return segments;
}

/**
 * URL の末尾の句読点・閉じかっこを外す。ただし「(」と対になっている「)」は URL の一部として残す
 * (例: https://ja.wikipedia.org/wiki/Foo_(bar))。「(https://example.com)」の閉じかっこは外す。
 */
function trimTrailing(url: string): string {
  let end = url.length;
  while (end > 0 && TRAILING.includes(url[end - 1])) {
    const body = url.slice(0, end);
    if (url[end - 1] === ')' && count(body, '(') >= count(body, ')')) {
      break;
    }
    end--;
  }
  return url.slice(0, end);
}

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}
