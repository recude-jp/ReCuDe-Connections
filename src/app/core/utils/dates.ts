import type { FieldValue, Timestamp } from '@angular/fire/firestore';

/** FirestoreのTimestampを「2026/9/25」形式で表示する。書き込み直後(serverTimestamp未確定)は空文字。 */
export function formatDate(value: Timestamp | FieldValue | null | undefined): string {
  if (!value || !('toDate' in value)) {
    return '';
  }
  return value.toDate().toLocaleDateString('ja-JP');
}

/** 並べ替え用のミリ秒。未確定の場合は最新扱いにする。 */
export function toMillis(value: Timestamp | FieldValue | null | undefined): number {
  return value && 'toMillis' in value ? value.toMillis() : Number.MAX_SAFE_INTEGER;
}

/** トーク一覧・メッセージの時刻表示。今日なら「14:05」、今年なら「9/25」、それ以前は「2025/9/25」。 */
export function formatMessageTime(value: Timestamp | FieldValue | null | undefined): string {
  if (!value || !('toDate' in value)) {
    return '';
  }
  const date = value.toDate();
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }
  return date.toLocaleDateString('ja-JP');
}
