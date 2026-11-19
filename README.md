# Album

A plain wallet for signed cards. Cards stay on your phone; Album talks to no server.

Cards are issuer-signed Nostr-format events. The card engine in `src/engine/` is copied unchanged from Grimoire OS (`src/card-holder/core/`, branch `feature/card-holder-v1`) and imports nothing from Grimoire.

## What works

- Add a card by file, pasted text, card link (`#card=` carries the whole card; nothing is fetched), or QR code where the browser supports it.
- Every card's signature is checked each time it is shown.
- Cards from an issuer you haven't trusted, or given to a key that isn't yours, wait until you decide.
- Decks by issuer; card front and back; withdrawn-card lists.
- One card key per issuer, made on the phone.
- Backup file of everything, including card keys; load it to replace.
- Example cards to try it.

## Not yet

- Storage is not encrypted. Anyone who can open Album on the phone can see the cards.
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
