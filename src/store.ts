import { parseHolder, type HolderState } from "./engine/schema";
import { isEnvelope, type Envelope } from "./vault";

/**
 * Album keeps one record on this device, in IndexedDB: the encrypted vault (see vault.ts).
 * Builds from before the recovery words kept the holder state there unencrypted; that is read once and
 * carried into the new vault, then overwritten.
 */
const DB = "album";
const STORE = "holder";
const KEY = "state";

/** Thrown when this browser gives Album no storage at all (some embedded previews). Album then runs for this visit only. */
export class NoStorage extends Error {}
export type Stored = { kind: "none" } | { kind: "legacy"; holder: HolderState } | { kind: "vault"; envelope: Envelope };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadStored(): Promise<Stored> {
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
  if (raw === undefined) return { kind: "none" };
  if (isEnvelope(raw)) return { kind: "vault", envelope: raw };
  // A record that is neither is refused rather than replaced, so nothing is lost by accident.
  return { kind: "legacy", holder: parseHolder(raw) };
}

export async function saveEnvelope(envelope: Envelope): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(envelope, KEY);
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
