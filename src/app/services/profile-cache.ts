import type { EncryptedProfileResponse } from './profile-response-crypto';

export interface CachedProfile {
  envelope: EncryptedProfileResponse;
  privateKey: CryptoKey;
  fetchedAt: number;
}

export async function profileCache(path: string, entry?: CachedProfile | null): Promise<CachedProfile | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('sbm-encrypted-profiles', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('profiles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<CachedProfile | undefined>((resolve, reject) => {
      const transaction = db.transaction('profiles', entry !== undefined ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('profiles');
      const request = store.get(path);
      request.onsuccess = () => {
        if (entry === null) store.delete(path);
        if (entry && (!request.result || request.result.fetchedAt <= entry.fetchedAt)) store.put(entry, path);
      };
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
