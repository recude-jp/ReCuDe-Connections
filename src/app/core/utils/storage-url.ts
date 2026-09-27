import { environment } from '../../../environments/environment';

/**
 * 公開読み取りの Storage のファイル(storage.rules で allow read: if true のもの)のURL。
 * getDownloadURL の問い合わせをしないため、一覧を開いたときにファイルの数だけ通信しない。
 */
export function publicStorageUrl(path: string): string {
  const host = environment.useEmulators ? 'http://localhost:9199' : 'https://firebasestorage.googleapis.com';
  return `${host}/v0/b/${environment.firebase.storageBucket}/o/${encodeURIComponent(path)}?alt=media`;
}
