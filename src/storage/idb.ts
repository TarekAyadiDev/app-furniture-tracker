import type { Item, Measurement, Option, Room } from "@/lib/domain";

const DB_NAME = "furnishing-tracker";
const DB_VERSION = 1;

type StoreName = "items" | "options" | "measurements" | "rooms" | "meta";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains("items")) {
        const store = db.createObjectStore("items", { keyPath: "id" });
        store.createIndex("room", "room", { unique: false });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }

      if (!db.objectStoreNames.contains("options")) {
        const store = db.createObjectStore("options", { keyPath: "id" });
        store.createIndex("itemId", "itemId", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }

      if (!db.objectStoreNames.contains("measurements")) {
        const store = db.createObjectStore("measurements", { keyPath: "id" });
        store.createIndex("room", "room", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }

      if (!db.objectStoreNames.contains("rooms")) {
        const store = db.createObjectStore("rooms", { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }

      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Failed to open IndexedDB"));
  });

  return dbPromise;
}

async function withStore<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return await new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const s = tx.objectStore(store);
    const req = fn(s);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error || new Error("IndexedDB request failed"));
  });
}

async function withTx<T>(
  stores: StoreName[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(stores, mode);
  try {
    const res = await fn(tx);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    });
    return res;
  } catch (err) {
    try {
      tx.abort();
    } catch {
      // ignore
    }
    throw err;
  }
}

export async function idbGetAll<T>(store: StoreName): Promise<T[]> {
  return await withStore<T[]>(store, "readonly", (s) => s.getAll());
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  return (await withStore<T | undefined>(store, "readonly", (s) => s.get(key))) as T | undefined;
}

export async function idbPut<T>(store: StoreName, value: T): Promise<void> {
  await withStore(store, "readwrite", (s) => s.put(value));
}

export async function idbDelete(store: StoreName, key: string): Promise<void> {
  await withStore(store, "readwrite", (s) => s.delete(key));
}

export async function idbClear(store: StoreName): Promise<void> {
  await withStore(store, "readwrite", (s) => s.clear());
}

export async function idbBulkPut<T>(store: StoreName, values: T[]): Promise<void> {
  await withTx([store], "readwrite", async (tx) => {
    const s = tx.objectStore(store);
    for (const v of values) s.put(v as never);
    return;
  });
}

export async function idbResetAll(): Promise<void> {
  await withTx(["items", "options", "measurements", "rooms", "meta"], "readwrite", async (tx) => {
    tx.objectStore("items").clear();
    tx.objectStore("options").clear();
    tx.objectStore("measurements").clear();
    tx.objectStore("rooms").clear();
    tx.objectStore("meta").clear();
    return;
  });
}

export type DbSnapshot = {
  items: Item[];
  options: Option[];
  measurements: Measurement[];
  rooms: Room[];
  meta: Record<string, unknown>;
};

export async function idbGetSnapshot(): Promise<DbSnapshot> {
  const [items, options, measurements, rooms, metaRaw] = await Promise.all([
    idbGetAll<Item>("items"),
    idbGetAll<Option>("options"),
    idbGetAll<Measurement>("measurements"),
    idbGetAll<Room>("rooms"),
    idbGetAll<{ key: string; value: unknown }>("meta"),
  ]);
  const meta: Record<string, unknown> = {};
  for (const row of metaRaw) meta[row.key] = row.value;
  return { items, options, measurements, rooms, meta };
}

export async function idbSetMeta(key: string, value: unknown): Promise<void> {
  await idbPut("meta", { key, value });
}

export async function idbGetMeta<T>(key: string): Promise<T | undefined> {
  const row = await idbGet<{ key: string; value: T }>("meta", key);
  return row?.value;
}
