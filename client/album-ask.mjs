// Asking Album about cards, from another app. No dependencies; copy this file into your app.
// The rules it follows are in docs/bridge.md in Jimbus9/album.
//
//   import { askAlbum, readAlbumAnswer } from "./album-ask.mjs";
//   askAlbum({ app: "Grimoire OS", slugs: ["first-lock"] });   // sends the person to Album
//   const answer = readAlbumAnswer();                           // on the page Album sends them back to
//   if (answer?.ok) answer.cards.forEach(...)

export const ALBUM_URL = "https://jimbus9.github.io/album/";
const ANSWER_MARK = "#album-answer=";
const STATE_KEY = "album-ask-state";

function b64url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/**
 * Sends the person to Album with your request.
 * app: your app's name as the person knows it (up to 24 characters).
 * slugs: the card handles you want to know about.
 * issuers: optional list of issuer public keys (64-character hex); only cards they signed are reported.
 * returnTo: where Album sends the person back; defaults to this page. Must be https (or localhost).
 */
export function askAlbum({ app, slugs, issuers, returnTo = location.href.split("#")[0], albumUrl = ALBUM_URL }) {
  const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  sessionStorage.setItem(STATE_KEY, state);
  const request = { v: 1, app, return: returnTo, slugs, state, ...(issuers ? { issuers } : {}) };
  location.assign(albumUrl.split("#")[0] + "#ask=" + b64url(JSON.stringify(request)));
}

/**
 * Reads Album's answer from this page's address, if there is one, and removes it from the address.
 * Returns null when there is no answer, or when it isn't the answer to the request this tab sent.
 * The answer is { ok: true, cards: [...] } or { ok: false, reason: "declined" | "not-granted" | "invalid-request" }.
 * Each card: { cardId, slug, title, stage?, issuerTier, issuerLabel, status, awardedAt }.
 */
export function readAlbumAnswer() {
  if (!location.hash.startsWith(ANSWER_MARK)) return null;
  const raw = location.hash.slice(ANSWER_MARK.length);
  history.replaceState(null, "", location.pathname + location.search);
  const expected = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  try {
    const answer = JSON.parse(unb64url(raw));
    if (answer?.v !== 1 || !expected || answer.state !== expected) return null;
    return answer;
  } catch {
    return null;
  }
}
