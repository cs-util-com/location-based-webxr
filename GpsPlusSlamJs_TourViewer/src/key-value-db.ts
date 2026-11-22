/**
 * A string-keyed store in the browser's IndexedDB: one database with one
 * object store, for pages that keep a few values (file handles, photos)
 * across reloads. Page-free but for the factory the page passes.
 *
 * @see key-value-db.ts.md
 */

/** A key-value store: IndexedDB's object store, or a test's Map. Every
 *  call may reject; the caller decides what a failure means. */
export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/**
 * The browser's IndexedDB as a {@link KeyValueStore}: database `name`
 * with one object store `storeName`, opened on first use (a failed open is
 * tried again at the next call), one transaction per call. Null where the
 * browser has no IndexedDB.
 */
export function indexedDbKeyValueStore(
  factory: IDBFactory | undefined,
  name: string,
  storeName: string,
): KeyValueStore | null {
  if (factory === undefined) return null;
  let db: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(storeName);
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error("IndexedDB did not open"));
      };
      request.onblocked = () => {
        reject(new Error("IndexedDB is blocked by another tab"));
      };
    }).catch((err: unknown) => {
      db = null;
      throw err;
    });
    return db;
  };
  const run = async <T>(
    mode: IDBTransactionMode,
    op: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const database = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = database.transaction(storeName, mode);
      const request = op(tx.objectStore(storeName));
      tx.oncomplete = () => {
        resolve(request.result);
      };
      const failed = () => {
        reject(tx.error ?? new Error("IndexedDB transaction failed"));
      };
      tx.onerror = failed;
      tx.onabort = failed;
    });
  };
  return {
    get: (key) => run("readonly", (store) => store.get(key)),
    put: async (key, value) => {
      await run("readwrite", (store) => store.put(value, key));
    },
    delete: async (key) => {
      await run("readwrite", (store) => store.delete(key));
    },
    keys: async () =>
      (await run("readonly", (store) => store.getAllKeys())).map(String),
  };
}
