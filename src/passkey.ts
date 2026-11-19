import { b64, unb64 } from "./vault";

/**
 * Fingerprint or face unlock, through a passkey and the WebAuthn PRF extension.
 * The passkey gives back the same secret every time it is used with the same salt, and only after the phone's own
 * fingerprint, face or screen-lock check. Album turns that secret into a key that unlocks the vault.
 * Nothing leaves the phone except what the browser's passkey provider does with the passkey itself.
 */
const RP_NAME = "Album";

export function passkeysPossible(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials?.create && window.isSecureContext;
}

function random(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}
type PrfResults = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };

/** Makes a passkey and returns its id, the salt and the secret, or a reason it couldn't. */
export async function makePasskey(): Promise<{ ok: true; id: string; salt: Uint8Array<ArrayBuffer>; output: Uint8Array<ArrayBuffer> } | { ok: false; reason: string }> {
  if (!passkeysPossible()) return { ok: false, reason: "This browser can't use a fingerprint or face for Album." };
  const salt = random(32);
  try {
    const credential = (await navigator.credentials.create({
      publicKey: {
        rp: { name: RP_NAME },
        user: { id: random(16), name: "Album", displayName: "Album" },
        challenge: random(32),
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
        extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    if (!credential) return { ok: false, reason: "No passkey was made." };
    const results = credential.getClientExtensionResults() as PrfResults;
    if (!results.prf?.enabled) return { ok: false, reason: "This phone's passkeys can't unlock Album. Keep using your passcode." };
    const id = b64(new Uint8Array(credential.rawId));
    // Some providers return the secret straight away; others only when the passkey is first used.
    const first = results.prf.results?.first;
    const output = first ? new Uint8Array(first) : await usePasskey(id, salt);
    if (!output) return { ok: false, reason: "The passkey was made, but it didn't give Album what it needs. Keep using your passcode." };
    return { ok: true, id, salt, output };
  } catch {
    return { ok: false, reason: "Cancelled, or this phone can't make a passkey here." };
  }
}

/** Asks for the fingerprint or face and returns the passkey's secret, or null. */
export async function usePasskey(id: string, salt: Uint8Array<ArrayBuffer> | string): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!passkeysPossible()) return null;
  try {
    const credential = (await navigator.credentials.get({
      publicKey: {
        challenge: random(32),
        allowCredentials: [{ type: "public-key", id: unb64(id) }],
        userVerification: "required",
        extensions: { prf: { eval: { first: typeof salt === "string" ? unb64(salt) : salt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    const first = (credential?.getClientExtensionResults() as PrfResults | undefined)?.prf?.results?.first;
    return first ? new Uint8Array(first) : null;
  } catch {
    return null;
  }
}
