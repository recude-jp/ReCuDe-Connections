/**
 * 端末に置く会員の秘密鍵(IndexedDB)。秘密鍵は「取り出せない CryptoKey」のまま保存する
 * (ページのスクリプトからも鍵の中身は読めず、この端末のブラウザの中でだけ使える)。
 */

const DB_NAME = 'recude-e2ee';
const STORE = 'memberKeys';

export interface StoredMemberKey {
  keyId: string;
  privateKey: CryptoKey;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function storeKey(tenantId: string, memberId: string): string {
  return `${tenantId}/${memberId}`;
}

export async function loadMemberKey(tenantId: string, memberId: string): Promise<StoredMemberKey | null> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(storeKey(tenantId, memberId));
      request.onsuccess = () => resolve((request.result as StoredMemberKey | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function saveMemberKey(tenantId: string, memberId: string, key: StoredMemberKey): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(key, storeKey(tenantId, memberId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
