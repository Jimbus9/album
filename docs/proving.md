# Proving you hold a card

A bridge answer (docs/bridge.md) is Album's word, carried by the holder's own browser: fine for an app serving the holder, but not proof to anyone else. Proving is for that: showing someone else, who doesn't have to trust you, your phone or Album, that you hold a card.

## What gets proved

Two signatures:

1. **The issuer's, on the card.** The card names the card key it was given to, and the issuer's key signed it. Nobody else can make or change it.
2. **The holder's, on a fresh challenge.** The checker makes a random challenge and names themselves (the "audience"). Album signs both with the card key the card names. Only whoever holds that key can do it.

Together: the issuer gave this card to this key, and the person in front of you holds this key, now.

The check passes only if the proof answers a challenge this checker gave out, for this checker, signed in the last 10 minutes, with the key the card names. A challenge works once.

## What the checker must still do

- **Check the issuer key.** A card can call its issuer anything; the key is what counts. Give the check page the issuer's published key and it says whether it matches. Without one, compare it yourself.
- **Withdrawn cards aren't checked yet.** The page doesn't look at the issuer's list of withdrawn cards.

## What the holder gives away

The checker sees the card, what it says, who issued it, and the card key it was given to. Not other cards and not the recovery words. Album makes one card key per issuer, so a proof of a Kop Fund card doesn't link to cards from anyone else.

## How it runs

- The checker opens `https://jimbus9.github.io/album/check.html` (no Album, no account) and makes a request. It shows a QR code and a link with `#prove=` and the request (version 1: `{ v, challenge, audience, slug? }`), plus a four-character check code.
- The holder scans or opens it. Their Album shows who is asking and the same check code, and which card to prove. On their yes it makes the proof.
- The holder sends it back: a link to the check page with `#proof=`, or text starting `ALBUM-PROOF:`. The checker opens the link or pastes the text.
- Challenges wait in the checker's browser for 15 minutes. Nothing goes through a server.

The signing and checking are the card engine's own (`proveOwnership`, `verifyHolderProof` in `src/engine/`).
