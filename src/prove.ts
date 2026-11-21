import { readCard, verifyHolderProof, type HolderProof, type ParsedCard } from "./engine/protocol";
import { proveOwnership } from "./engine/holder";
import type { HolderState, StoredEvent } from "./engine/schema";
import { fromBase64Url, toBase64Url } from "./links";

/**
 * Proving you hold a card, to anyone. See docs/proving.md.
 *
 * The checker makes a fresh random challenge and names themselves (the "audience"). Album, with the person's yes,
 * signs that challenge with the key the card was given to. The checker then knows two things from two signatures:
 * the issuer gave this card to that key, and whoever holds that key just signed their fresh challenge.
 */
export const PROVE_MARK = "#prove=";
export const PROOF_MARK = "#proof=";
export const PROOF_TEXT = "ALBUM-PROOF:";

export type ProveRequest = { v: 1; challenge: string; audience: string; slug?: string };
export type ProofBundle = { format: "album-proof"; v: 1; definition: StoredEvent; award: StoredEvent; proof: HolderProof };

function cleanLine(x: unknown, max: number): x is string {
  return typeof x === "string" && x.trim().length > 0 && x.length <= max && !/[\u0000-\u001f\u007f]/.test(x);
}

export function makeRequest(audience: string, slug?: string): ProveRequest {
  const challenge = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  return { v: 1, challenge, audience, ...(slug ? { slug } : {}) };
}
export function requestLink(albumUrl: string, request: ProveRequest): string {
  return albumUrl.split("#")[0] + PROVE_MARK + toBase64Url(JSON.stringify(request));
}
export function parseRequest(hash: string): ProveRequest | null {
  if (!hash.startsWith(PROVE_MARK)) return null;
  const text = fromBase64Url(hash.slice(PROVE_MARK.length));
  if (!text || text.length > 2000) return null;
  try {
    const x = JSON.parse(text);
    if (x?.v !== 1 || typeof x.challenge !== "string" || !/^[0-9a-f]{32}$/.test(x.challenge) || !cleanLine(x.audience, 100)) return null;
    if (x.slug !== undefined && !cleanLine(x.slug, 64)) return null;
    return { v: 1, challenge: x.challenge, audience: x.audience.trim(), ...(x.slug ? { slug: x.slug } : {}) };
  } catch {
    return null;
  }
}
/** The short code both screens show, so the person can see they're answering the right checker. */
export function checkCode(challenge: string): string {
  return challenge.slice(0, 4).toUpperCase();
}

/** Album's side: sign the challenge, with the person's explicit yes. */
export function makeProof(state: HolderState, cardId: string, request: ProveRequest, nowSeconds: number): { ok: true; bundle: ProofBundle } | { ok: false; reason: string } {
  const held = state.cards.find((card) => card.award.id === cardId);
  if (!held) return { ok: false, reason: "That card isn't in your Album." };
  const result = proveOwnership(state, { cardId, challenge: request.challenge, audience: request.audience, consent: true }, nowSeconds);
  if (!result.ok) return result;
  return { ok: true, bundle: { format: "album-proof", v: 1, definition: held.definition, award: held.award, proof: result.proof } };
}
export function proofText(bundle: ProofBundle): string {
  return PROOF_TEXT + toBase64Url(JSON.stringify(bundle));
}
export function proofLink(checkUrl: string, bundle: ProofBundle): string {
  return checkUrl.split("#")[0] + PROOF_MARK + toBase64Url(JSON.stringify(bundle));
}

/** Pulls a proof out of whatever was pasted or opened: the text, a link, or the hash. */
export function readProofInput(input: string): ProofBundle | null {
  const text = input.trim();
  let encoded: string | null = null;
  const at = text.indexOf(PROOF_MARK);
  if (at !== -1) encoded = text.slice(at + PROOF_MARK.length);
  else {
    const p = text.indexOf(PROOF_TEXT);
    if (p !== -1) encoded = text.slice(p + PROOF_TEXT.length);
  }
  if (!encoded) return null;
  const json = fromBase64Url(encoded.split(/\s/)[0]);
  if (!json || json.length > 100_000) return null;
  try {
    const x = JSON.parse(json);
    if (x?.format !== "album-proof" || x.v !== 1) return null;
    return x as ProofBundle;
  } catch {
    return null;
  }
}

export type Pending = { challenge: string; audience: string; issuer: string | null; madeAt: number };
export type CheckResult =
  | { ok: true; card: ParsedCard; issuerMatches: boolean | null; audience: string }
  | { ok: false; reason: string };

/** The checker's side. `pending` is every challenge this checker has given out and not yet used. `now` in seconds. */
export function checkProof(bundle: ProofBundle, pending: Pending[], nowSeconds: number): CheckResult {
  const read = readCard(bundle.definition, bundle.award);
  if (!read.ok) return { ok: false, reason: read.reason };
  const proof = bundle.proof?.proof;
  const asked = pending.find((item) => item.challenge === proof?.content);
  if (!asked) return { ok: false, reason: "This proof answers a challenge this page didn't give out (or one already used). Make a new request." };
  if (!verifyHolderProof(bundle.proof, read.card, asked.challenge, asked.audience, nowSeconds))
    return { ok: false, reason: "The proof doesn't check out. It wasn't signed by the key the card was given to, it's for someone else, or it's more than 10 minutes old." };
  return { ok: true, card: read.card, issuerMatches: asked.issuer ? asked.issuer === read.card.issuer : null, audience: asked.audience };
}
