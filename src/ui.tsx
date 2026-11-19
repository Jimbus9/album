import { nip19 } from "nostr-tools";
import type { CardView } from "./engine/holder";

/** A deep colour picked from the issuer's key, so each issuer's cards look alike and two issuers rarely match. */
const COLOURS = ["#5E0A12", "#1F4D3A", "#2346A8", "#5B2A86", "#7A3F06", "#0F5E66", "#3A3F47"];
export function issuerColour(pubkey: string): string {
  let n = 0;
  for (let i = 0; i < 8; i++) n = (n * 16 + parseInt(pubkey[i] ?? "0", 16)) % 1_000_003;
  return COLOURS[n % COLOURS.length];
}
export function npub(pubkey: string): string {
  try {
    return nip19.npubEncode(pubkey);
  } catch {
    return pubkey;
  }
}
export function shortNpub(pubkey: string): string {
  const text = npub(pubkey);
  return text.slice(0, 9) + "…" + text.slice(-4);
}
function initials(title: string): string {
  const words = title.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : title.slice(0, 2)).toUpperCase();
}
export function formatDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export function CardFace({ view, big, onOpen }: { view: CardView; big?: boolean; onOpen?: () => void }) {
  const card = view.card;
  const title = card?.definition.title ?? "Broken card";
  const collection = card?.definition.collection ?? "Unknown";
  const colour = card ? issuerColour(card.issuer) : "#3A3F47";
  const dim = view.checks.status === "revoked" || view.checks.status === "expired" || !card;
  const inner = (
    <>
      <span className="row" style={{ justifyContent: "space-between", fontSize: big ? 14 : 12, fontWeight: 600 }}>
        <span>{collection}</span>
        {card?.definition.stage !== undefined && <span className="mono">Stage {card.definition.stage}</span>}
      </span>
      <span className="mark" aria-hidden="true">{initials(title)}</span>
      <span className="col" style={{ gap: 4 }}>
        <span className="t">{title}</span>
        <span style={{ fontSize: big ? 15 : 12 }}>
          {view.checks.status === "revoked" ? "Withdrawn by the issuer" : view.checks.status === "expired" ? "Expired" : card?.claims.claim}
        </span>
      </span>
    </>
  );
  const style = { background: colour };
  if (onOpen)
    return (
      <button type="button" className={"card" + (dim ? " revoked" : "")} style={style} onClick={onOpen} aria-label={title + ", " + collection}>
        {inner}
      </button>
    );
  return (
    <div className={"card big" + (dim ? " revoked" : "")} style={style}>
      {inner}
    </div>
  );
}

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
export const Icon = {
  plus: (size = 22) => (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} strokeWidth={2.2} aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
  ),
  back: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} strokeWidth={2.2} aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
  ),
  chevron: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
  ),
  info: (colour = "#8A5A00") => (
    <svg width="22" height="22" viewBox="0 0 24 24" {...stroke} stroke={colour} aria-hidden="true" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.5" /></svg>
  ),
  tick: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} stroke="#0A6B3B" strokeWidth={2.4} aria-hidden="true" style={{ flexShrink: 0 }}><path d="M5 12l5 5 9-10" /></svg>
  ),
  cross: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} stroke="#A3111D" strokeWidth={2.4} aria-hidden="true" style={{ flexShrink: 0 }}><path d="M6 6l12 12M18 6L6 18" /></svg>
  ),
  album: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><rect x="3" y="4" width="8" height="11" rx="1.5" /><rect x="13" y="4" width="8" height="11" rx="1.5" /><path d="M3 19h18" /></svg>
  ),
  apps: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
  ),
  qr: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M8 12h8" /></svg>
  ),
  file: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></svg>
  ),
};
