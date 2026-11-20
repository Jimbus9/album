import { HOLDER_LIMITS, type HolderState } from "./engine/schema";
import { grantPlug, isGranted, readThroughPlug, type PlugCard, type PlugRequest } from "./engine/plug";
import { toBase64Url, fromBase64Url } from "./links";

/**
 * The bridge: how an app on another page asks Album about cards. See docs/bridge.md.
 *
 * The app opens Album with "#ask=" and the request. Album shows the person who is asking and for what. On yes,
 * Album sends them back to the app's return address with "#album-answer=" and the answer. Nothing goes through
 * a server: both travel in the part of the address after "#", which browsers never send to a website.
 */
export const ASK_MARK = "#ask=";
export const ANSWER_MARK = "#album-answer=";
export const BRIDGE_VERSION = 1;
const NAME_MAX = 24;

export type AskRequest = {
  /** The name the app gives itself, shown to the person. Not trusted on its own: `place` is what Album remembers. */
  name: string;
  /** The site and first folder of the return address, e.g. "jimbus9.github.io/grimoire-os". */
  place: string;
  /** Where the answer goes. Always on `place`. */
  returnTo: string;
  slugs: string[];
  /** If given, only cards signed by these issuer keys (hex) are reported. */
  issuers: string[] | null;
  /** The app's own random string, sent back unchanged so it knows the answer is to its request. */
  state: string;
  /** What the grant is stored under: name and place together. */
  app: string;
};
export type AskAnswer =
  | { v: 1; state: string; ok: true; cards: PlugCard[] }
  | { v: 1; state: string; ok: false; reason: "declined" | "not-granted" | "invalid-request" };
export type ParsedAsk = { ok: true; request: AskRequest } | { ok: false; reason: string };

function isLocal(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/** Reads and checks a request. Anything odd is refused, and nothing is sent anywhere for a refused request. */
export function parseAsk(hash: string): ParsedAsk {
  if (!hash.startsWith(ASK_MARK)) return { ok: false, reason: "Not a request." };
  const text = fromBase64Url(hash.slice(ASK_MARK.length));
  if (!text || text.length > 20_000) return { ok: false, reason: "This request is damaged." };
  let x: Record<string, unknown>;
  try {
    x = JSON.parse(text);
  } catch {
    return { ok: false, reason: "This request is damaged." };
  }
  if (x?.v !== BRIDGE_VERSION) return { ok: false, reason: "This request is for a different version of Album." };
  const name = typeof x.app === "string" ? x.app.trim() : "";
  if (name.length < 1 || name.length > NAME_MAX) return { ok: false, reason: "The app asking didn't give a name Album can show." };
  let url: URL;
  try {
    url = new URL(String(x.return));
  } catch {
    return { ok: false, reason: "The app asking didn't say where to send the answer." };
  }
  if (url.username || url.password) return { ok: false, reason: "The return address isn't safe to send to." };
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal(url.hostname)))
    return { ok: false, reason: "Album only answers apps on secure (https) addresses." };
  const folder = url.pathname.split("/").filter(Boolean)[0];
  const place = url.host + (folder ? "/" + folder : "");
  url.hash = "";
  const app = name + " · " + place;
  if (app.length > HOLDER_LIMITS.label) return { ok: false, reason: "The app's address is too long for Album to remember." };
  const slugs = Array.isArray(x.slugs) ? [...new Set(x.slugs.filter((s): s is string => typeof s === "string"))] : [];
  if (slugs.length < 1 || slugs.length > HOLDER_LIMITS.slugs || !slugs.every((s) => s.length > 0 && s.length <= 64) || slugs.length !== (x.slugs as unknown[]).length)
    return { ok: false, reason: "The request doesn't list the cards properly." };
  let issuers: string[] | null = null;
  if (x.issuers !== undefined) {
    if (!Array.isArray(x.issuers) || x.issuers.length < 1 || x.issuers.length > 50 || !x.issuers.every((k) => typeof k === "string" && /^[0-9a-f]{64}$/.test(k)))
      return { ok: false, reason: "The request lists issuers Album can't read." };
    issuers = [...new Set(x.issuers as string[])];
  }
  const state = typeof x.state === "string" ? x.state : "";
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(state)) return { ok: false, reason: "The request is missing its check code." };
  return { ok: true, request: { name, place, returnTo: url.toString(), slugs, issuers, state, app } };
}

function plugRequest(ask: AskRequest): PlugRequest {
  return { app: ask.app, slugs: ask.slugs };
}
export function alreadyAllowed(state: HolderState, ask: AskRequest): boolean {
  return isGranted(state, plugRequest(ask));
}
export function allow(state: HolderState, ask: AskRequest, nowIso: string): HolderState {
  return grantPlug(state, plugRequest(ask), nowIso);
}

/** The answer for a request the person has allowed (now or before). Only their own, checked, let-in cards. */
export function answerFor(state: HolderState, ask: AskRequest, now: number): AskAnswer {
  const read = readThroughPlug(state, plugRequest(ask), now);
  if (!read.ok) return { v: 1, state: ask.state, ok: false, reason: read.reason };
  const issuerOf = new Map(state.cards.map((card) => [card.award.id, card.award.pubkey]));
  const cards = ask.issuers ? read.cards.filter((card) => ask.issuers!.includes(issuerOf.get(card.cardId) ?? "")) : read.cards;
  return { v: 1, state: ask.state, ok: true, cards };
}
export function declined(ask: AskRequest): AskAnswer {
  return { v: 1, state: ask.state, ok: false, reason: "declined" };
}
/** The address to send the person back to, carrying the answer. */
export function answerAddress(ask: AskRequest, answer: AskAnswer): string {
  return ask.returnTo + ANSWER_MARK + toBase64Url(JSON.stringify(answer));
}
