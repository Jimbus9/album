import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools";
import { copyEvent, isHex64, isStoredEvent, type StoredEvent } from "./schema";

/**
 * Grimoire card format v1. Framework-free so it can be lifted into its own package later.
 *
 * A card is two issuer-signed events: a definition (what the card is) and an award (who it was given to).
 * Signing and verification are Schnorr signatures from nostr-tools. No cryptography is invented here,
 * and nothing in this file touches the network. Event kinds are provisional and never published in v1.
 *
 * A valid signature proves who issued a card. It does not prove real-world attainment.
 */
export const CARD_FORMAT = "grimoire-card";
export const REVOCATION_FORMAT = "grimoire-revocations";
export const PROOF_FORMAT = "grimoire-holder-proof";
export const BUNDLE_FORMAT = "grimoire-card-bundle";
export const MAX_BUNDLE_FILE = 8_000_000;
export const DEFINITION_KIND = 30110;
export const AWARD_KIND = 8110;
export const REVOCATION_KIND = 30111;
export const PROOF_KIND = 22110;
const MAX_FILE = 64_000;
const MAX_REVOCATION_FILE = 1_500_000;
const MAX_REVOKED = 20_000;
const PROOF_WINDOW_SECONDS = 600;

export type CardCategory = "credential" | "collectible";
export type CardDefinition = {
  title: string;
  description: string;
  category: CardCategory;
  /** The name the issuer gives itself. A claim, not an identity: always show the key beside it. */
  issuerName: string;
  /** The issuer's name for the deck this card belongs to. */
  collection: string;
  /** Top-level grouping inside the collection. For the Wizard Path this is the pillar. */
  group?: string;
  track?: string;
  stage?: number;
  criteria: string;
  criteriaVersion: string;
  /** SHA-256 of the artwork file. Artwork is never fetched when a card is opened. */
  artHash?: string;
};
export type AwardClaims = {
  claim: string;
  /** SHA-256 commitment to the evidence. The evidence itself never travels with the card. */
  evidence?: string;
  /** Unix seconds. */
  expiresAt?: number;
};
export type ParsedCard = {
  /** The award event id. Unique per award. */
  id: string;
  /** Issuer key plus definition id. The title is never identity. */
  identity: string;
  /** The issuer's stable handle for this card definition. Only meaningful together with the issuer key. */
  slug: string;
  issuer: string;
  holder: string;
  definition: CardDefinition;
  claims: AwardClaims;
  awardedAt: number;
  events: { definition: StoredEvent; award: StoredEvent };
};
export type CardReadResult = { ok: true; card: ParsedCard } | { ok: false; reason: string };
export type RevocationReadResult =
  | { ok: true; issuer: string; listId: string; createdAt: number; revoked: string[] }
  | { ok: false; reason: string };
export type HolderProof = { format: typeof PROOF_FORMAT; version: 1; proof: StoredEvent };

function hexToBytes(hex: string): Uint8Array {
  if (!isHex64(hex)) throw new Error("Invalid key.");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
/** Rejects control characters and bidirectional overrides, which can be used to disguise text. */
function isCleanText(x: unknown, max: number, multiline = false): x is string {
  if (typeof x !== "string" || x.length < 1 || x.length > max || x.trim().length < 1) return false;
  for (const char of x) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 10 && multiline) continue;
    if (code < 32 || code === 127) return false;
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return false;
  }
  return true;
}
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
function tagValue(event: StoredEvent, name: string): string | undefined {
  const matches = event.tags.filter((tag) => tag[0] === name);
  return matches.length === 1 && matches[0].length === 2 ? matches[0][1] : undefined;
}
function sign(secretKey: string, kind: number, tags: string[][], content: string, createdAt: number): StoredEvent {
  return copyEvent(finalizeEvent({ kind, created_at: createdAt, tags, content }, hexToBytes(secretKey)));
}
function signatureValid(event: StoredEvent): boolean {
  try {
    return verifyEvent(copyEvent(event));
  } catch {
    return false;
  }
}

export function generateKey(): { secretKey: string; publicKey: string } {
  const secret = generateSecretKey();
  return { secretKey: bytesToHex(secret), publicKey: getPublicKey(secret) };
}
export function publicKeyOf(secretKey: string): string {
  return getPublicKey(hexToBytes(secretKey));
}

function readDefinition(content: string): CardDefinition | null {
  const x = parseJson(content);
  if (!isRecord(x) || x.v !== 1) return null;
  if (!isCleanText(x.title, 80) || !isCleanText(x.description, 600, true)) return null;
  if (x.category !== "credential" && x.category !== "collectible") return null;
  if (!isCleanText(x.issuerName, 60) || !isCleanText(x.collection, 60)) return null;
  if (!isCleanText(x.criteria, 1200, true) || !isCleanText(x.criteriaVersion, 80)) return null;
  if (x.group !== undefined && !isCleanText(x.group, 60)) return null;
  if (x.track !== undefined && !isCleanText(x.track, 60)) return null;
  if (x.stage !== undefined && (typeof x.stage !== "number" || !Number.isInteger(x.stage) || x.stage < 1 || x.stage > 99))
    return null;
  if (x.artHash !== undefined && !isHex64(x.artHash)) return null;
  return {
    title: x.title,
    description: x.description,
    category: x.category,
    issuerName: x.issuerName,
    collection: x.collection,
    ...(x.group !== undefined ? { group: x.group as string } : {}),
    ...(x.track !== undefined ? { track: x.track as string } : {}),
    ...(x.stage !== undefined ? { stage: x.stage as number } : {}),
    criteria: x.criteria,
    criteriaVersion: x.criteriaVersion,
    ...(x.artHash !== undefined ? { artHash: x.artHash as string } : {}),
  };
}
function readClaims(content: string): AwardClaims | null {
  const x = parseJson(content);
  if (!isRecord(x) || x.v !== 1 || !isCleanText(x.claim, 600, true)) return null;
  if (x.evidence !== undefined && !isHex64(x.evidence)) return null;
  if (x.expiresAt !== undefined && (typeof x.expiresAt !== "number" || !Number.isSafeInteger(x.expiresAt) || x.expiresAt < 0))
    return null;
  return {
    claim: x.claim,
    ...(x.evidence !== undefined ? { evidence: x.evidence as string } : {}),
    ...(x.expiresAt !== undefined ? { expiresAt: x.expiresAt as number } : {}),
  };
}

/** Issuer side: signs a card definition. `slug` is the issuer's stable handle for this card. */
export function createDefinition(secretKey: string, slug: string, definition: CardDefinition, createdAt: number): StoredEvent {
  const content = JSON.stringify({ v: 1, ...definition });
  if (!isCleanText(slug, 64) || !readDefinition(content)) throw new Error("Invalid card definition.");
  return sign(secretKey, DEFINITION_KIND, [["d", slug]], content, createdAt);
}
/** Issuer side: signs an award of `definition` to one holder key. */
export function issueAward(secretKey: string, definition: StoredEvent, holder: string, claims: AwardClaims, createdAt: number): StoredEvent {
  const content = JSON.stringify({ v: 1, ...claims });
  if (!isHex64(holder) || !readClaims(content) || definition.pubkey !== publicKeyOf(secretKey))
    throw new Error("Invalid card award.");
  return sign(secretKey, AWARD_KIND, [["p", holder], ["def", definition.id]], content, createdAt);
}
export function packCard(definition: StoredEvent, award: StoredEvent): string {
  return JSON.stringify({ format: CARD_FORMAT, version: 1, definition, award });
}

/** Fully checks a definition and award pair: shape, both signatures, same issuer, and the award's link to the definition. */
export function readCard(definition: unknown, award: unknown): CardReadResult {
  if (!isStoredEvent(definition) || !isStoredEvent(award)) return { ok: false, reason: "The card is malformed or too large." };
  if (definition.kind !== DEFINITION_KIND || award.kind !== AWARD_KIND) return { ok: false, reason: "This is not a Grimoire card." };
  if (!signatureValid(definition) || !signatureValid(award)) return { ok: false, reason: "The signature does not match. This card has been altered or forged." };
  if (definition.pubkey !== award.pubkey) return { ok: false, reason: "The award was not signed by the issuer of the card it names." };
  if (tagValue(award, "def") !== definition.id) return { ok: false, reason: "The award points at a different card definition." };
  const holder = tagValue(award, "p");
  if (!isHex64(holder)) return { ok: false, reason: "The award names no holder." };
  const slug = tagValue(definition, "d");
  if (!isCleanText(slug, 64)) return { ok: false, reason: "The card definition has no valid handle." };
  const fields = readDefinition(definition.content);
  const claims = readClaims(award.content);
  if (!fields || !claims) return { ok: false, reason: "The card's details are invalid or contain disguised text." };
  return {
    ok: true,
    card: {
      id: award.id,
      identity: award.pubkey + ":" + definition.id,
      slug,
      issuer: award.pubkey,
      holder,
      definition: fields,
      claims,
      awardedAt: award.created_at,
      events: { definition: copyEvent(definition), award: copyEvent(award) },
    },
  };
}
/** Reads a card file, QR payload or pasted text. */
export function readCardFile(raw: string): CardReadResult {
  if (raw.length > MAX_FILE) return { ok: false, reason: "The card file is too large." };
  const x = parseJson(raw);
  if (!isRecord(x) || x.format !== CARD_FORMAT || x.version !== 1) return { ok: false, reason: "This is not a Grimoire card file." };
  return readCard(x.definition, x.award);
}

/** Issuer side: signs the complete list of revoked award ids. A newer list replaces an older one. */
export function createRevocationList(secretKey: string, revoked: string[], createdAt: number): string {
  if (revoked.length > MAX_REVOKED || !revoked.every(isHex64)) throw new Error("Invalid revocation list.");
  const list = sign(secretKey, REVOCATION_KIND, [["d", "revoked"]], JSON.stringify({ v: 1, revoked }), createdAt);
  return JSON.stringify({ format: REVOCATION_FORMAT, version: 1, list });
}
export function readRevocationFile(raw: string): RevocationReadResult {
  if (raw.length > MAX_REVOCATION_FILE) return { ok: false, reason: "The revocation list is too large." };
  const x = parseJson(raw);
  if (!isRecord(x) || x.format !== REVOCATION_FORMAT || x.version !== 1 || !isRecord(x.list))
    return { ok: false, reason: "This is not a revocation list." };
  const list = x.list;
  // Checked by hand because a revocation list may be far longer than a card event.
  if (
    !isHex64(list.id) || !isHex64(list.pubkey) || typeof list.sig !== "string" || !/^[0-9a-f]{128}$/.test(list.sig) ||
    list.kind !== REVOCATION_KIND || typeof list.created_at !== "number" || !Number.isSafeInteger(list.created_at) ||
    list.created_at < 0 || typeof list.content !== "string" || !Array.isArray(list.tags) || list.tags.length !== 1 ||
    !Array.isArray(list.tags[0]) || list.tags[0].length !== 2 || list.tags[0][0] !== "d" || list.tags[0][1] !== "revoked"
  )
    return { ok: false, reason: "The revocation list is malformed." };
  const event: StoredEvent = {
    id: list.id, pubkey: list.pubkey, created_at: list.created_at, kind: REVOCATION_KIND,
    tags: [["d", "revoked"]], content: list.content, sig: list.sig,
  };
  if (!signatureValid(event)) return { ok: false, reason: "The revocation list's signature does not match." };
  const body = parseJson(event.content);
  if (!isRecord(body) || body.v !== 1 || !Array.isArray(body.revoked) || body.revoked.length > MAX_REVOKED || !body.revoked.every(isHex64))
    return { ok: false, reason: "The revocation list is malformed." };
  return { ok: true, issuer: event.pubkey, listId: event.id, createdAt: event.created_at, revoked: [...(body.revoked as string[])] };
}

/**
 * Holder side: answers a verifier's fresh challenge by signing it with the key the card was awarded to.
 * Showing a proof reveals that key to the verifier, so the caller must get explicit consent first.
 */
export function signHolderProof(secretKey: string, awardId: string, challenge: string, audience: string, now: number): HolderProof {
  if (!isHex64(awardId) || !isCleanText(challenge, 200) || !isCleanText(audience, 100)) throw new Error("Invalid proof request.");
  const proof = sign(secretKey, PROOF_KIND, [["award", awardId], ["audience", audience]], challenge, now);
  return { format: PROOF_FORMAT, version: 1, proof };
}
/** Verifier side: true only if the proof was signed by the card's holder key, for this card, challenge and audience, recently. */
export function verifyHolderProof(input: unknown, card: ParsedCard, challenge: string, audience: string, now: number): boolean {
  if (!isRecord(input) || input.format !== PROOF_FORMAT || input.version !== 1 || !isStoredEvent(input.proof)) return false;
  const proof = input.proof;
  return (
    proof.kind === PROOF_KIND &&
    proof.pubkey === card.holder &&
    proof.content === challenge &&
    tagValue(proof, "award") === card.id &&
    tagValue(proof, "audience") === audience &&
    Math.abs(now - proof.created_at) <= PROOF_WINDOW_SECONDS &&
    signatureValid(proof)
  );
}

/** Tells a card file from a revocation list without trusting either. */
export function detectFile(raw: string): "card" | "revocations" | "bundle" | "unknown" {
  if (raw.length > MAX_BUNDLE_FILE) return "unknown";
  const x = parseJson(raw);
  if (!isRecord(x)) return "unknown";
  return x.format === CARD_FORMAT ? "card" : x.format === REVOCATION_FORMAT ? "revocations" : x.format === BUNDLE_FORMAT ? "bundle" : "unknown";
}
