import { HOLDER_LIMITS, isHex64, type CardSet, type HeldCard, type HolderKey, type HolderState } from "./schema";
import {
  BUNDLE_FORMAT,
  MAX_BUNDLE_FILE,
  packCard,
  detectFile,
  readCard,
  readCardFile,
  readRevocationFile,
  signHolderProof,
  type HolderProof,
  type ParsedCard,
} from "./protocol";

/**
 * The card holder. One flat pile of signed cards; decks and sets are views computed over it.
 * The holder knows no app's or issuer's rules. Cards unlock nothing: apps decide what a card means to them,
 * and they see cards only through the plug (see plug.ts).
 * All functions are pure and return a new state. Nothing here touches the network.
 */
export type IssuerTier = "canonical" | "ai-assessed" | "trusted" | "unknown";
export type BuiltInIssuer = { pubkey: string; label: string; tier: "canonical" | "ai-assessed" };
/**
 * Issuer keys that ship with the app. Empty on purpose: the canonical Wizard Path key and the AI examiner key
 * have not been created yet. The two tiers are separate so an AI-assessed card can never display as canonical.
 */
export const BUILT_IN_ISSUERS: readonly BuiltInIssuer[] = [];

export type CardChecks = {
  signature: "valid" | "invalid";
  issuerTier: IssuerTier;
  /** Your label for a trusted issuer, otherwise the name the issuer claims for itself. */
  issuerLabel: string;
  holderKey: "yours" | "not-yours";
  /** v1 has no issuance logs yet, so this is always "unlogged". */
  issuance: "unlogged";
  status: "active" | "revoked" | "expired" | "unknown";
  /** When the issuer's revocation list was last checked for this card. */
  statusAsOf?: string;
};
export type CardView = {
  id: string;
  held: HeldCard;
  /** Null when the stored card no longer verifies, for example after a tampered backup. */
  card: ParsedCard | null;
  problem?: string;
  checks: CardChecks;
};
export type ImportOutcome =
  | { kind: "added"; id: string; state: HolderState }
  | { kind: "quarantined"; id: string; state: HolderState; why: string }
  | { kind: "duplicate"; id: string; state: HolderState }
  | { kind: "revocations"; state: HolderState; issuer: string; revokedHere: number }
  | { kind: "bundle"; state: HolderState; added: number; quarantined: number; duplicate: number; rejected: number }
  | { kind: "rejected"; state: HolderState; reason: string };

function tierOf(state: HolderState, issuer: string, builtIns: readonly BuiltInIssuer[]): { tier: IssuerTier; label?: string } {
  const builtIn = builtIns.find((item) => item.pubkey === issuer);
  if (builtIn) return { tier: builtIn.tier, label: builtIn.label };
  const trusted = state.trusted.find((item) => item.pubkey === issuer);
  return trusted ? { tier: "trusted", label: trusted.label } : { tier: "unknown" };
}
function cleanLabel(value: string): string | null {
  const label = value.trim().replace(/\s+/g, " ");
  return label.length > 0 && label.length <= HOLDER_LIMITS.label ? label : null;
}
export function shortKey(pubkey: string): string {
  return pubkey.slice(0, 8) + "…" + pubkey.slice(-4);
}

/** Verifies every stored card again and works out its checks. `now` is milliseconds since the epoch. */
export function viewCards(state: HolderState, now: number, builtIns: readonly BuiltInIssuer[] = BUILT_IN_ISSUERS): CardView[] {
  return state.cards.map((held) => {
    const result = readCard(held.definition, held.award);
    const issuer = held.award.pubkey;
    const { tier, label } = tierOf(state, issuer, builtIns);
    if (!result.ok)
      return {
        id: held.award.id,
        held,
        card: null,
        problem: result.reason,
        checks: { signature: "invalid", issuerTier: tier, issuerLabel: label ?? shortKey(issuer), holderKey: "not-yours", issuance: "unlogged", status: "unknown" },
      };
    const card = result.card;
    const check = state.revocations.find((item) => item.issuer === issuer);
    let status: CardChecks["status"] = "unknown";
    let statusAsOf: string | undefined;
    if (check && check.revoked.includes(card.id)) {
      status = "revoked";
      statusAsOf = check.importedAt;
    } else if (card.claims.expiresAt !== undefined && card.claims.expiresAt * 1000 <= now) status = "expired";
    else if (check && Date.parse(held.receivedAt) <= Date.parse(check.importedAt)) {
      status = "active";
      statusAsOf = check.importedAt;
    }
    return {
      id: card.id,
      held,
      card,
      checks: {
        signature: "valid",
        issuerTier: tier,
        issuerLabel: label ?? card.definition.issuerName,
        holderKey: state.keys.some((key) => key.publicKey === card.holder) ? "yours" : "not-yours",
        issuance: "unlogged",
        status,
        ...(statusAsOf ? { statusAsOf } : {}),
      },
    };
  });
}

/**
 * Receives a card file or a revocation list. Forged or malformed input is rejected and changes nothing.
 * A card from a trusted issuer, awarded to one of your keys, goes straight in. Anything else waits in quarantine.
 * Importing never grants any permission, and importing the same award twice is a no-op.
 */
export function importFile(state: HolderState, raw: string, nowIso: string, builtIns: readonly BuiltInIssuer[] = BUILT_IN_ISSUERS): ImportOutcome {
  const type = detectFile(raw);
  if (type === "revocations") return importRevocations(state, raw, nowIso);
  if (type === "bundle") return importBundle(state, raw, nowIso, builtIns);
  if (type !== "card") return { kind: "rejected", state, reason: "This is not a Grimoire card file." };
  const result = readCardFile(raw);
  if (!result.ok) return { kind: "rejected", state, reason: result.reason };
  const card = result.card;
  if (state.cards.some((held) => held.award.id === card.id)) return { kind: "duplicate", id: card.id, state };
  if (state.cards.length >= HOLDER_LIMITS.cards) return { kind: "rejected", state, reason: "The holder is full." };
  const trusted = tierOf(state, card.issuer, builtIns).tier !== "unknown";
  const yours = state.keys.some((key) => key.publicKey === card.holder);
  const status = trusted && yours ? "held" : "quarantined";
  const next: HolderState = {
    ...state,
    cards: [...state.cards, { award: card.events.award, definition: card.events.definition, status, receivedAt: nowIso }],
  };
  if (status === "held") return { kind: "added", id: card.id, state: next };
  return {
    kind: "quarantined",
    id: card.id,
    state: next,
    why: !trusted ? "You have not trusted this issuer." : "This card was awarded to a key that is not in your vault.",
  };
}
/** Imports every card in a bundle through the same checks as a single card. */
function importBundle(state: HolderState, raw: string, nowIso: string, builtIns: readonly BuiltInIssuer[]): ImportOutcome {
  let parsed: unknown;
  try {
    parsed = raw.length <= MAX_BUNDLE_FILE ? JSON.parse(raw) : undefined;
  } catch {
    parsed = undefined;
  }
  const cards = (parsed as { version?: unknown; cards?: unknown } | undefined)?.cards;
  if ((parsed as { version?: unknown } | undefined)?.version !== 1 || !Array.isArray(cards) || cards.length > HOLDER_LIMITS.cards)
    return { kind: "rejected", state, reason: "This card bundle is malformed." };
  const tally = { added: 0, quarantined: 0, duplicate: 0, rejected: 0 };
  let next = state;
  for (const card of cards) {
    const entry = card as { definition?: unknown; award?: unknown } | null;
    const outcome = importFile(next, packCard(entry?.definition as never, entry?.award as never), nowIso, builtIns);
    next = outcome.state;
    if (outcome.kind === "added") tally.added++;
    else if (outcome.kind === "quarantined") tally.quarantined++;
    else if (outcome.kind === "duplicate") tally.duplicate++;
    else tally.rejected++;
  }
  return { kind: "bundle", state: next, ...tally };
}
/**
 * Every card you hold, as one file any compatible holder can import. Cards stay verifiable without Grimoire.
 * Receiving keys are not included: they travel only inside your encrypted vault backup.
 */
export function exportBundle(state: HolderState): string {
  const cards = state.cards.filter((held) => held.status === "held").map((held) => ({ definition: held.definition, award: held.award }));
  return JSON.stringify({ format: BUNDLE_FORMAT, version: 1, cards });
}
function importRevocations(state: HolderState, raw: string, nowIso: string): ImportOutcome {
  const result = readRevocationFile(raw);
  if (!result.ok) return { kind: "rejected", state, reason: result.reason };
  const previous = state.revocations.find((item) => item.issuer === result.issuer);
  if (previous && previous.listCreatedAt > result.createdAt)
    return { kind: "rejected", state, reason: "You already hold a newer revocation list from this issuer." };
  if (!previous && state.revocations.length >= HOLDER_LIMITS.checks)
    return { kind: "rejected", state, reason: "Too many revocation lists are stored." };
  const listed = new Set(result.revoked);
  const revoked = state.cards.filter((held) => held.award.pubkey === result.issuer && listed.has(held.award.id)).map((held) => held.award.id);
  return {
    kind: "revocations",
    issuer: result.issuer,
    revokedHere: revoked.length,
    state: {
      ...state,
      revocations: [
        ...state.revocations.filter((item) => item.issuer !== result.issuer),
        { issuer: result.issuer, listId: result.listId, listCreatedAt: result.createdAt, importedAt: nowIso, revoked },
      ],
    },
  };
}

/** Lets a quarantined card in. Pass `trustAs` to also trust its issuer under your own label. */
export function acceptCard(state: HolderState, id: string, nowIso: string, trustAs?: string, builtIns: readonly BuiltInIssuer[] = BUILT_IN_ISSUERS): HolderState {
  const held = state.cards.find((item) => item.award.id === id);
  if (!held) return state;
  const cards = state.cards.map((item) => (item.award.id === id ? { ...item, status: "held" as const } : item));
  const label = trustAs === undefined ? null : cleanLabel(trustAs);
  const issuer = held.award.pubkey;
  const alreadyKnown = tierOf(state, issuer, builtIns).tier !== "unknown";
  if (!label || alreadyKnown || state.trusted.length >= HOLDER_LIMITS.trusted) return { ...state, cards };
  return { ...state, cards, trusted: [...state.trusted, { pubkey: issuer, label, addedAt: nowIso }] };
}
/** Removes a card from the holder and from every set. Used to reject a quarantined card or release a held one. */
export function removeCard(state: HolderState, id: string): HolderState {
  return {
    ...state,
    cards: state.cards.filter((item) => item.award.id !== id),
    sets: state.sets.map((set) => ({ ...set, cardIds: set.cardIds.filter((cardId) => cardId !== id) })),
  };
}

/** Stops trusting an issuer. Its cards stay, but show as coming from an unknown issuer. */
export function untrustIssuer(state: HolderState, pubkey: string): HolderState {
  return { ...state, trusted: state.trusted.filter((item) => item.pubkey !== pubkey) };
}

/** Stores a new receiving key. The caller generates it; give each issuer its own. */
export function addKey(state: HolderState, label: string, key: { secretKey: string; publicKey: string }, nowIso: string): HolderState {
  const clean = cleanLabel(label);
  if (!clean || !isHex64(key.secretKey) || !isHex64(key.publicKey)) return state;
  if (state.keys.length >= HOLDER_LIMITS.keys || state.keys.some((item) => item.publicKey === key.publicKey)) return state;
  const entry: HolderKey = { label: clean, publicKey: key.publicKey, secretKey: key.secretKey, createdAt: nowIso };
  return { ...state, keys: [...state.keys, entry] };
}

export function createSet(state: HolderState, id: string, name: string): HolderState {
  const clean = cleanLabel(name);
  if (!clean || id.length < 1 || id.length > 64 || state.sets.length >= HOLDER_LIMITS.sets || state.sets.some((set) => set.id === id)) return state;
  const entry: CardSet = { id, name: clean, cardIds: [] };
  return { ...state, sets: [...state.sets, entry] };
}
export function deleteSet(state: HolderState, id: string): HolderState {
  return { ...state, sets: state.sets.filter((set) => set.id !== id) };
}
/** Adds a held card to a set, or takes it out. The card itself never moves. */
export function toggleInSet(state: HolderState, setId: string, cardId: string): HolderState {
  if (!state.cards.some((item) => item.award.id === cardId && item.status === "held")) return state;
  return {
    ...state,
    sets: state.sets.map((set) =>
      set.id !== setId
        ? set
        : { ...set, cardIds: set.cardIds.includes(cardId) ? set.cardIds.filter((item) => item !== cardId) : [...set.cardIds, cardId] },
    ),
  };
}

export type Deck = { issuer: string; label: string; tier: IssuerTier; collections: string[]; cards: CardView[] };
const TIER_RANK: Record<IssuerTier, number> = { canonical: 0, "ai-assessed": 1, trusted: 2, unknown: 3 };
/** Held cards grouped by issuer key. Two issuers that claim the same name still get separate decks. */
export function decks(views: CardView[]): Deck[] {
  const byIssuer = new Map<string, Deck>();
  for (const view of views) {
    if (view.held.status !== "held") continue;
    const issuer = view.held.award.pubkey;
    const deck = byIssuer.get(issuer) ?? { issuer, label: view.checks.issuerLabel, tier: view.checks.issuerTier, collections: [], cards: [] };
    deck.cards.push(view);
    const collection = view.card?.definition.collection;
    if (collection && !deck.collections.includes(collection)) deck.collections.push(collection);
    byIssuer.set(issuer, deck);
  }
  return [...byIssuer.values()].sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.label.localeCompare(b.label) || a.issuer.localeCompare(b.issuer));
}

export type ProofRequest = { cardId: string; challenge: string; audience: string; consent: boolean };
export type ProofResult = { ok: true; proof: HolderProof } | { ok: false; reason: string };
/**
 * Signs a verifier's challenge with the key a card was awarded to. Refuses without explicit consent,
 * because a proof reveals that holder key to whoever receives it. `now` is seconds since the epoch.
 */
export function proveOwnership(state: HolderState, request: ProofRequest, now: number): ProofResult {
  if (request.consent !== true) return { ok: false, reason: "Proving ownership needs your explicit consent." };
  const held = state.cards.find((item) => item.award.id === request.cardId && item.status === "held");
  if (!held) return { ok: false, reason: "That card is not in your holder." };
  const result = readCard(held.definition, held.award);
  if (!result.ok) return { ok: false, reason: result.reason };
  const key = state.keys.find((item) => item.publicKey === result.card.holder);
  if (!key) return { ok: false, reason: "This card was awarded to a key that is not in your vault." };
  try {
    return { ok: true, proof: signHolderProof(key.secretKey, result.card.id, request.challenge.trim(), request.audience.trim(), now) };
  } catch {
    return { ok: false, reason: "The challenge or audience is empty or contains invalid characters." };
  }
}
