import type { LineageEntry } from './lineage.ts';

// Persistence for the tree of life. The signed Merkle-DAG lineage is stored in
// IndexedDB and reloaded on every visit, so the genealogy *grows across
// sessions*. (When the swarm exists, this local store becomes one node's view
// of a single shared genealogy — see docs/DEPLOY-coordinator.md.)

const DB_NAME = 'autograph';
const STORE = 'lineage';
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

/** All persisted lineage entries, oldest first. Returns [] if storage is off. */
export async function loadLineage(): Promise<LineageEntry[]> {
  try {
    const db = await open();
    return await new Promise<LineageEntry[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const rows = req.result as LineageEntry[];
        rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        resolve(rows);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/** Persist one entry (idempotent on id). Silently no-ops if storage is off. */
export async function saveEntry(entry: LineageEntry): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* storage unavailable — the session simply won't persist */
  }
}

export async function saveEntries(entries: LineageEntry[]): Promise<void> {
  for (const e of entries) await saveEntry(e);
}
