// The most recently opened media file, kept in IndexedDB so it can be reopened on the next visit.
// (localStorage can't hold binary data of this size; IndexedDB stores the Blob as-is.)

const DB_NAME = 'learn-by-ear';
const STORE = 'files';
const RECENT = 'recent';

/** Files larger than this aren't kept, to avoid doubling disk use for big videos. */
export const RECENT_FILE_MAX_BYTES = 100 * 1024 * 1024;

interface StoredFile {
  name: string;
  type: string;
  lastModified: number;
  blob: Blob;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? req.error);
    });
  } finally {
    db.close();
  }
}

/** Remember `file` for next time (or forget the previous one if `file` is too big to keep). */
export async function saveRecentFile(file: File) {
  try {
    if (file.size > RECENT_FILE_MAX_BYTES) return await forgetRecentFile();
    const record: StoredFile = { name: file.name, type: file.type, lastModified: file.lastModified, blob: file };
    await withStore('readwrite', (s) => s.put(record, RECENT));
    // Ask the browser not to evict it under storage pressure; harmless if refused.
    void navigator.storage?.persist?.().catch(() => {});
  } catch (e) {
    console.warn('Could not remember file for next visit', e);
  }
}

export async function loadRecentFile(): Promise<File | null> {
  try {
    const record = await withStore<StoredFile | undefined>('readonly', (s) => s.get(RECENT));
    if (!record?.blob) return null;
    return new File([record.blob], record.name, { type: record.type, lastModified: record.lastModified });
  } catch (e) {
    console.warn('Could not read remembered file', e);
    return null;
  }
}

export async function forgetRecentFile() {
  try {
    await withStore('readwrite', (s) => s.delete(RECENT));
  } catch (e) {
    console.warn('Could not forget remembered file', e);
  }
}
