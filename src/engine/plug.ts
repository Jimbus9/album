import { HOLDER_LIMITS, type HolderState } from "./schema";
import { BUILT_IN_ISSUERS, viewCards, type BuiltInIssuer, type IssuerTier } from "./holder";

/**
 * The plug: the only way an app sees your cards.
 *
 * An app names itself and lists the card handles (slugs) it cares about. You grant that exact request once.
 * After that, the app learns only which of those cards you hold, from what tier of issuer, and whether each
 * is still in force. It never sees your keys, your other cards, your sets, or what a card claims.
 * Only cards you have let in, that verify, and that were awarded to one of your keys are ever reported.
 */
export type PlugRequest = { app: string; slugs: string[] };
export type PlugCard = {
  cardId: string;
  slug: string;
  title: string;
  stage?: number;
  issuerTier: IssuerTier;
  /** Your label for a trusted issuer, otherwise the name the issuer gives itself. */
  issuerLabel: string;
  status: "active" | "revoked" | "expired" | "unknown";
  awardedAt: number;
};
export type PlugAnswer = { ok: true; cards: PlugCard[] } | { ok: false; reason: "not-granted" | "invalid-request" };

function cleanRequest(request: PlugRequest): PlugRequest | null {
  const app = request.app.trim();
  const slugs = [...new Set(request.slugs)];
  if (app.length < 1 || app.length > HOLDER_LIMITS.label) return null;
  if (slugs.length < 1 || slugs.length > HOLDER_LIMITS.slugs || !slugs.every((slug) => slug.length > 0 && slug.length <= 64)) return null;
  return { app, slugs };
}

/** True when this app already holds a grant covering every slug it is asking about. */
export function isGranted(state: HolderState, request: PlugRequest): boolean {
  const clean = cleanRequest(request);
  if (!clean) return false;
  const grant = state.grants.find((item) => item.app === clean.app);
  return !!grant && clean.slugs.every((slug) => grant.slugs.includes(slug));
}

/** Records your consent. Call only from an explicit user action. Replaces any earlier grant for the same app. */
export function grantPlug(state: HolderState, request: PlugRequest, nowIso: string): HolderState {
  const clean = cleanRequest(request);
  if (!clean) return state;
  const others = state.grants.filter((item) => item.app !== clean.app);
  if (others.length >= HOLDER_LIMITS.grants) return state;
  return { ...state, grants: [...others, { app: clean.app, slugs: clean.slugs, grantedAt: nowIso }] };
}

export function revokePlug(state: HolderState, app: string): HolderState {
  return { ...state, grants: state.grants.filter((item) => item.app !== app) };
}

/** Answers an app's request with the minimum it needs, or refuses if you have not granted it. `now` is milliseconds. */
export function readThroughPlug(
  state: HolderState,
  request: PlugRequest,
  now: number,
  builtIns: readonly BuiltInIssuer[] = BUILT_IN_ISSUERS,
): PlugAnswer {
  const clean = cleanRequest(request);
  if (!clean) return { ok: false, reason: "invalid-request" };
  if (!isGranted(state, clean)) return { ok: false, reason: "not-granted" };
  const wanted = new Set(clean.slugs);
  const cards: PlugCard[] = [];
  for (const view of viewCards(state, now, builtIns)) {
    if (view.held.status !== "held" || !view.card || view.checks.holderKey !== "yours" || !wanted.has(view.card.slug)) continue;
    cards.push({
      cardId: view.id,
      slug: view.card.slug,
      title: view.card.definition.title,
      ...(view.card.definition.stage !== undefined ? { stage: view.card.definition.stage } : {}),
      issuerTier: view.checks.issuerTier,
      issuerLabel: view.checks.issuerLabel,
      status: view.checks.status,
      awardedAt: view.card.awardedAt,
    });
  }
  return { ok: true, cards };
}
