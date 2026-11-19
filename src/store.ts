import { emptyHolder, parseHolder, type HolderState } from "./engine/schema";

/**
 * Album keeps one record on this device: the holder state, in IndexedDB.
 * It is not encrypted in this first version. Anyone who can open Album on this phone can see the cards.
 */
const DB = "album";
const STORE = "holder";
const KEY = "state";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Thrown when this browser gives Album no storage at all (some embedded previews). Album then runs for this visit only. */
export class NoStorage extends Error {}

export async function loadState(): Promise<HolderState> {
  let db: IDBDatabase;
  try {
    if (typeof indexedDB === "undefined") throw new Error();
    db = await open();
  } catch {
    throw new NoStorage();
  }
  const raw = await new Promise<unknown>((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  if (raw === undefined) return emptyHolder;
  // A stored record that no longer validates is refused rather than silently replaced, so nothing is lost by accident.
  return parseHolder(raw);
}

export async function saveState(state: HolderState): Promise<void> {
  const checked = parseHolder(state);
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(checked, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** Asks the browser not to clear Album's storage when space runs low. The answer is up to the browser. */
export async function askToKeepStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
