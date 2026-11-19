import { accountFromSeedWords, generateSeedWords, validateWords } from "nostr-tools/nip06";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { emptyHolder, parseHolder, type HolderState } from "./engine/schema";
import { readCardFile } from "./engine/protocol";
import type { StoredEvent } from "./engine/schema";
import { addKey } from "./engine/holder";

/**
 * Album's recovery words and the encrypted vault.
 *
 * Every card key comes from the 12 recovery words by NIP-06 (account n = card key n), so the words alone
 * bring every key back. The holder state and the words are stored encrypted with the passcode
 * (PBKDF2-SHA256, then AES-256-GCM, both from the browser's WebCrypto). Backup files are encrypted with a key
 * worked out from the words, so the words alone open a backup.
 */
export type Vault = { v: 1; words: string; nextIndex: number; holder: HolderState };
export type Envelope = { v: 1; kdf: "pbkdf2-sha256"; iterations: number; salt: string; iv: string; data: string };
export type Unlocked = { vault: Vault; key: CryptoKey; salt: Uint8Array };

export const WORDS = wordlist;
export const ITERATIONS = 600_000;
/** How far Album looks along the words for a key it has lost track of, for example after a restore. */
export const SCAN = 200;
const BACKUP_FORMAT = "album-backup";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function newWords(): string {
  return generateSeedWords();
}
export function cleanWords(input: string): string {
  return input.trim().toLowerCase().split(/\s+/).join(" ");
}
export function wordsValid(input: string): boolean {
  const words = cleanWords(input);
  return words.split(" ").length === 12 && validateWords(words);
}
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
/** Card key number `index`, worked out from the words. */
export function deriveKey(words: string, index: number): { secretKey: string; publicKey: string } {
  const account = accountFromSeedWords(words, "", index);
  return { secretKey: hex(account.privateKey), publicKey: account.publicKey };
}
/** Finds which key number a public key is, if it comes from these words. */
export function findIndex(words: string, publicKey: string, upTo = SCAN): number | null {
  for (let i = 0; i < upTo; i++) if (deriveKey(words, i).publicKey === publicKey) return i;
  return null;
}

function b64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function unb64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}
function random(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}
async function passcodeKey(passcode: string, salt: Uint8Array<ArrayBuffer>, iterations = ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", encoder.encode(passcode), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function wordsKey(words: string): Promise<CryptoKey> {
  // A key for backups only, kept apart from every card key by its own label.
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode("album-backup-v1\n" + cleanWords(words)));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function seal(key: CryptoKey, plain: unknown): Promise<{ iv: string; data: string }> {
  const iv = random(12);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(plain))));
  return { iv: b64(iv), data: b64(data) };
}
async function open(key: CryptoKey, iv: string, data: string): Promise<unknown> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, key, unb64(data));
  return JSON.parse(decoder.decode(plain));
}

function parseVault(x: unknown): Vault {
  const v = x as Partial<Vault> | null;
  if (!v || v.v !== 1 || typeof v.words !== "string" || !wordsValid(v.words) || !Number.isSafeInteger(v.nextIndex) || (v.nextIndex as number) < 0)
    throw new Error("Invalid vault.");
  return { v: 1, words: v.words, nextIndex: v.nextIndex as number, holder: parseHolder(v.holder) };
}

/** Makes a new vault from words and a passcode. `holder` carries over cards from before the words existed. */
export async function createVault(words: string, passcode: string, holder: HolderState = emptyHolder): Promise<{ unlocked: Unlocked; envelope: Envelope }> {
  const salt = random(16);
  const key = await passcodeKey(passcode, salt);
  const vault: Vault = { v: 1, words: cleanWords(words), nextIndex: 0, holder };
  const unlocked = { vault, key, salt };
  return { unlocked, envelope: await lockVault(unlocked) };
}
export async function lockVault(unlocked: Unlocked): Promise<Envelope> {
  const { iv, data } = await seal(unlocked.key, unlocked.vault);
  return { v: 1, kdf: "pbkdf2-sha256", iterations: ITERATIONS, salt: b64(unlocked.salt), iv, data };
}
/** Opens the vault. A wrong passcode throws. */
export async function unlockVault(envelope: Envelope, passcode: string): Promise<Unlocked> {
  const salt = unb64(envelope.salt);
  const key = await passcodeKey(passcode, salt, envelope.iterations);
  const vault = parseVault(await open(key, envelope.iv, envelope.data));
  return { vault, key, salt };
}
export function isEnvelope(x: unknown): x is Envelope {
  const e = x as Partial<Envelope> | null;
  return !!e && e.v === 1 && e.kdf === "pbkdf2-sha256" && typeof e.salt === "string" && typeof e.iv === "string" && typeof e.data === "string" && Number.isSafeInteger(e.iterations);
}

/** Makes the next card key from the words and stores it under the issuer's name. */
export function makeKey(vault: Vault, label: string, nowIso: string): Vault | null {
  const holder = addKey(vault.holder, label, deriveKey(vault.words, vault.nextIndex), nowIso);
  return holder === vault.holder ? null : { ...vault, holder, nextIndex: vault.nextIndex + 1 };
}

/**
 * Before a card or bundle is imported: if it was given to a key that comes from these words but isn't stored
 * (after a restore from the words), the key is worked out again and stored, so the card arrives as yours.
 */
export function recoverKeysFor(vault: Vault, raw: string, nowIso: string): Vault {
  const holders: { publicKey: string; label: string }[] = [];
  try {
    const x = JSON.parse(raw);
    const pairs: { definition: StoredEvent; award: StoredEvent }[] =
      x?.format === "grimoire-card" ? [x] : x?.format === "grimoire-card-bundle" && Array.isArray(x.cards) ? x.cards.slice(0, 2000) : [];
    for (const pair of pairs) {
      const read = readCardFile(JSON.stringify({ format: "grimoire-card", version: 1, definition: pair.definition, award: pair.award }));
      if (read.ok) holders.push({ publicKey: read.card.holder, label: read.card.definition.issuerName });
    }
  } catch {
    return vault;
  }
  let next = vault;
  const known = new Set(vault.holder.keys.map((key) => key.publicKey));
  for (const holder of holders) {
    if (known.has(holder.publicKey)) continue;
    const index = findIndex(next.words, holder.publicKey, Math.max(SCAN, next.nextIndex + 50));
    if (index === null) continue;
    next = { ...next, holder: addKey(next.holder, holder.label, deriveKey(next.words, index), nowIso), nextIndex: Math.max(next.nextIndex, index + 1) };
    known.add(holder.publicKey);
  }
  return next;
}

/** A backup file anyone may hold: encrypted with a key from the words, so only the words open it. */
export async function makeBackup(vault: Vault): Promise<string> {
  const { iv, data } = await seal(await wordsKey(vault.words), { nextIndex: vault.nextIndex, holder: vault.holder });
  return JSON.stringify({ format: BACKUP_FORMAT, version: 2, iv, data });
}
export type BackupRead = { ok: true; holder: HolderState; nextIndex: number } | { ok: false; reason: string };
export async function readBackup(raw: string, words: string): Promise<BackupRead> {
  let x: { format?: unknown; version?: unknown; iv?: unknown; data?: unknown; state?: unknown };
  try {
    x = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "That isn't an Album backup file." };
  }
  if (x?.format !== BACKUP_FORMAT) return { ok: false, reason: "That isn't an Album backup file." };
  try {
    // Version 1 backups were made before Album had recovery words and are not encrypted.
    if (x.version === 1) return { ok: true, holder: parseHolder(x.state), nextIndex: 0 };
    if (x.version !== 2 || typeof x.iv !== "string" || typeof x.data !== "string") throw new Error();
    const body = (await open(await wordsKey(words), x.iv, x.data)) as { nextIndex?: unknown; holder?: unknown };
    const nextIndex = Number.isSafeInteger(body.nextIndex) && (body.nextIndex as number) >= 0 ? (body.nextIndex as number) : 0;
    return { ok: true, holder: parseHolder(body.holder), nextIndex };
  } catch {
    return { ok: false, reason: "This backup was made with different recovery words, or it's damaged." };
  }
}
