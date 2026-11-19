/** A card link carries the whole card file after "#card=", so opening it sends nothing to any server. */
export const LINK_MARK = "#card=";

export function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromBase64Url(text: string): string | null {
  try {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
    const binary = atob(padded);
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return null;
  }
}
/** Turns whatever was pasted, scanned or opened into the text of a card file. A link is unwrapped; anything else is passed through. */
export function unwrapInput(input: string): string {
  const text = input.trim();
  const at = text.indexOf(LINK_MARK);
  if (at === -1) return text;
  return fromBase64Url(text.slice(at + LINK_MARK.length)) ?? text;
}
export function cardLink(base: string, file: string): string {
  return base.split("#")[0] + LINK_MARK + toBase64Url(file);
}
