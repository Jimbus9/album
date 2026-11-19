/** A signed Nostr-format event exactly as received. Stored verbatim so signatures stay checkable. */
export type StoredEvent = { id:string; pubkey:string; created_at:number; kind:number; tags:string[][]; content:string; sig:string };
/** One card in the holder: the issuer-signed award plus the definition it points at. */
export type HeldCard = { award:StoredEvent; definition:StoredEvent; status:"held"|"quarantined"; receivedAt:string };
/** A receiving key. One per issuer, so two issuers cannot link the same holder. Secret stays inside the encrypted vault. */
export type HolderKey = { label:string; publicKey:string; secretKey:string; createdAt:string };
export type TrustedIssuer = { pubkey:string; label:string; addedAt:string };
/** A user-made collection. Holds award ids only; cards are never copied or moved. */
export type CardSet = { id:string; name:string; cardIds:string[] };
/** Result of checking an issuer's signed revocation list. Only ids held here are kept, so a long list cannot bloat the vault. */
export type RevocationCheck = { issuer:string; listId:string; listCreatedAt:number; importedAt:string; revoked:string[] };
/** Permission for one app to see, through the plug, whether you hold cards with these definition slugs. */
export type PlugGrant = { app:string; slugs:string[]; grantedAt:string };
export type HolderState = { version:1; cards:HeldCard[]; keys:HolderKey[]; trusted:TrustedIssuer[]; sets:CardSet[]; revocations:RevocationCheck[]; grants:PlugGrant[] };
export const emptyHolder:HolderState = {version:1,cards:[],keys:[],trusted:[],sets:[],revocations:[],grants:[]};
/**
 * Structural validation for everything the card holder stores.
 * The holder's import path uses the same event check, so anything it accepts can always be saved and reopened.
 * Signatures are NOT checked here: they are re-checked whenever a card is shown.
 */
export const HOLDER_LIMITS = {
  tags: 16,
  tagItems: 4,
  tagChars: 256,
  content: 6000,
  cards: 2000,
  keys: 200,
  trusted: 200,
  sets: 200,
  checks: 200,
  grants: 50,
  slugs: 200,
  label: 60,
} as const;
const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
const FAIL = "Invalid card holder data.";

export function isHex64(x: unknown): x is string {
  return typeof x === "string" && HEX64.test(x);
}
function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function isDate(x: unknown): x is string {
  return typeof x === "string" && x.length <= 40 && Number.isFinite(Date.parse(x));
}
function isLabel(x: unknown): x is string {
  return typeof x === "string" && x.length > 0 && x.length <= HOLDER_LIMITS.label;
}
function isTimestamp(x: unknown): x is number {
  return typeof x === "number" && Number.isSafeInteger(x) && x >= 0 && x < 100_000_000_000;
}

/** True when the value has the exact shape of a signed event within holder size limits. */
export function isStoredEvent(x: unknown): x is StoredEvent {
  if (!isRecord(x)) return false;
  if (!isHex64(x.id) || !isHex64(x.pubkey)) return false;
  if (typeof x.sig !== "string" || !HEX128.test(x.sig)) return false;
  if (!isTimestamp(x.created_at)) return false;
  if (typeof x.kind !== "number" || !Number.isInteger(x.kind) || x.kind < 0 || x.kind > 65535) return false;
  if (typeof x.content !== "string" || x.content.length > HOLDER_LIMITS.content) return false;
  if (!Array.isArray(x.tags) || x.tags.length > HOLDER_LIMITS.tags) return false;
  for (const tag of x.tags) {
    if (!Array.isArray(tag) || tag.length < 1 || tag.length > HOLDER_LIMITS.tagItems) return false;
    for (const item of tag)
      if (typeof item !== "string" || item.length > HOLDER_LIMITS.tagChars) return false;
  }
  return true;
}

/** Copies only the signed fields, dropping anything else that was attached to the object. */
export function copyEvent(e: StoredEvent): StoredEvent {
  return {
    id: e.id,
    pubkey: e.pubkey,
    created_at: e.created_at,
    kind: e.kind,
    tags: e.tags.map((tag) => [...tag]),
    content: e.content,
    sig: e.sig,
  };
}

/** Validates and copies holder data from a decrypted vault or backup. Throws on anything malformed. */
export function parseHolder(x: unknown): HolderState {
  if (!isRecord(x) || x.version !== 1) throw new Error(FAIL);
  const { cards, keys, trusted, sets, revocations } = x;
  // Plug grants were added after the first holder build, so their absence is valid.
  const grants = x.grants === undefined ? [] : x.grants;
  if (
    !Array.isArray(cards) || cards.length > HOLDER_LIMITS.cards ||
    !Array.isArray(keys) || keys.length > HOLDER_LIMITS.keys ||
    !Array.isArray(trusted) || trusted.length > HOLDER_LIMITS.trusted ||
    !Array.isArray(sets) || sets.length > HOLDER_LIMITS.sets ||
    !Array.isArray(revocations) || revocations.length > HOLDER_LIMITS.checks ||
    !Array.isArray(grants) || grants.length > HOLDER_LIMITS.grants
  )
    throw new Error(FAIL);

  const awardIds = new Set<string>();
  const outCards: HeldCard[] = cards.map((card: unknown) => {
    if (
      !isRecord(card) || !isStoredEvent(card.award) || !isStoredEvent(card.definition) ||
      (card.status !== "held" && card.status !== "quarantined") ||
      !isDate(card.receivedAt) || awardIds.has(card.award.id)
    )
      throw new Error(FAIL);
    awardIds.add(card.award.id);
    return {
      award: copyEvent(card.award),
      definition: copyEvent(card.definition),
      status: card.status,
      receivedAt: card.receivedAt,
    };
  });

  const publicKeys = new Set<string>();
  const outKeys: HolderKey[] = keys.map((key: unknown) => {
    if (
      !isRecord(key) || !isLabel(key.label) || !isHex64(key.publicKey) ||
      !isHex64(key.secretKey) || !isDate(key.createdAt) || publicKeys.has(key.publicKey)
    )
      throw new Error(FAIL);
    publicKeys.add(key.publicKey);
    return { label: key.label, publicKey: key.publicKey, secretKey: key.secretKey, createdAt: key.createdAt };
  });

  const issuers = new Set<string>();
  const outTrusted: TrustedIssuer[] = trusted.map((issuer: unknown) => {
    if (
      !isRecord(issuer) || !isHex64(issuer.pubkey) || !isLabel(issuer.label) ||
      !isDate(issuer.addedAt) || issuers.has(issuer.pubkey)
    )
      throw new Error(FAIL);
    issuers.add(issuer.pubkey);
    return { pubkey: issuer.pubkey, label: issuer.label, addedAt: issuer.addedAt };
  });

  const setIds = new Set<string>();
  const outSets: CardSet[] = sets.map((set: unknown) => {
    if (
      !isRecord(set) || typeof set.id !== "string" || set.id.length < 1 || set.id.length > 64 ||
      setIds.has(set.id) || !isLabel(set.name) || !Array.isArray(set.cardIds) ||
      set.cardIds.length > HOLDER_LIMITS.cards || !set.cardIds.every(isHex64) ||
      new Set(set.cardIds).size !== set.cardIds.length
    )
      throw new Error(FAIL);
    setIds.add(set.id);
    return { id: set.id, name: set.name, cardIds: [...(set.cardIds as string[])] };
  });

  const checked = new Set<string>();
  const outChecks: RevocationCheck[] = revocations.map((check: unknown) => {
    if (
      !isRecord(check) || !isHex64(check.issuer) || checked.has(check.issuer) ||
      !isHex64(check.listId) || !isTimestamp(check.listCreatedAt) || !isDate(check.importedAt) ||
      !Array.isArray(check.revoked) || check.revoked.length > HOLDER_LIMITS.cards ||
      !check.revoked.every(isHex64)
    )
      throw new Error(FAIL);
    checked.add(check.issuer);
    return {
      issuer: check.issuer,
      listId: check.listId,
      listCreatedAt: check.listCreatedAt,
      importedAt: check.importedAt,
      revoked: [...(check.revoked as string[])],
    };
  });

  const apps = new Set<string>();
  const outGrants: PlugGrant[] = grants.map((grant: unknown) => {
    if (
      !isRecord(grant) || !isLabel(grant.app) || apps.has(grant.app) || !isDate(grant.grantedAt) ||
      !Array.isArray(grant.slugs) || grant.slugs.length > HOLDER_LIMITS.slugs ||
      !grant.slugs.every((slug) => typeof slug === "string" && slug.length > 0 && slug.length <= 64)
    )
      throw new Error(FAIL);
    apps.add(grant.app);
    return { app: grant.app, slugs: [...(grant.slugs as string[])], grantedAt: grant.grantedAt };
  });

  return { version: 1, cards: outCards, keys: outKeys, trusted: outTrusted, sets: outSets, revocations: outChecks, grants: outGrants };
}
