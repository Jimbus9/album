# Album

A plain wallet for signed cards. Cards stay on your phone; Album talks to no server.

Cards are issuer-signed Nostr-format events. The card engine in `src/engine/` is copied unchanged from Grimoire OS (`src/card-holder/core/`, branch `feature/card-holder-v1`) and imports nothing from Grimoire.

## What works

- Add a card by file, pasted text, card link (`#card=` carries the whole card; nothing is fetched), or QR code where the browser supports it.
- Every card's signature is checked each time it is shown.
- Cards from an issuer you haven't trusted, or given to a key that isn't yours, wait until you decide.
- Decks by issuer; card front and back; withdrawn-card lists.
- **Recovery words.** On first open Album makes 12 words (or takes yours). Every card key comes from them by NIP-06 (card key n = account n), so the words alone bring every key back. After a restore, a card arriving for one of those keys is recognised and its key re-made.
- **The Crowdlock app's word practices.** The paper copy is checked every word, one at a time, with suggestions from the standard word list (never from the words). Boxes that take words turn off autocomplete, autocorrect and spellcheck. Words show only while being made and, after that, behind an unlock. A web app can't block screenshots the way the Crowdlock app does, so those screens say so.
- **Fingerprint or face.** Optional, through a passkey and the WebAuthn PRF extension. The vault's data key is wrapped twice: by the passcode and by the passkey; either opens it. On Android, Google Password Manager keeps the passkey and may sync it to the person's other devices; the app says so.
- **Passcode.** The cards, keys and words are stored encrypted with it (PBKDF2-SHA256, 600,000 rounds, then AES-256-GCM, from the browser's WebCrypto). Album locks after five minutes out of sight. Forgot the passcode: start again from the words.
- One card key per issuer, so issuers can't link your cards.
- Backup file of every card, encrypted with a key from the recovery words: only the words open it.
- Example cards to try it.

## Not yet

- Keys made before the recovery words existed (earlier builds) can't be recovered from the words.
- Fingerprint unlock is tested with Chrome's virtual authenticator, not yet on a real phone.
- Apps can't ask for cards yet. The plug (`src/engine/plug.ts`) is built; the way another app reaches Album is not.
- Empty slots for cards not yet earned need a public catalogue from the issuer. Not built.
- Showing or hiding who issued a card isn't in the engine yet.
- Some engine messages still say "Grimoire card", because the engine is unchanged.

## Run

```
npm install
npm test
npm run build     # static site in dist/, with a service worker for offline use
```
