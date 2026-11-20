# The bridge: how an app asks Album about cards

Version 1. Any app on the web can use it: Grimoire OS, The Kop Fund's site, anything else. No server is involved. The request and the answer both travel in the part of a web address after `#`, which browsers never send to a website.

The ready-made helper is [`client/album-ask.mjs`](../client/album-ask.mjs) (also served at `https://jimbus9.github.io/album/album-ask.mjs`). Copy it into your app; it has no dependencies.

## What an app gets, and what it never gets

An app gets, for each card it asked about that the person holds and allows it to see:

| Field | What it is |
|---|---|
| `cardId` | The card's id (the award event's id). Stable; use it to cache. |
| `slug` | The card's handle, one of those the app asked for. |
| `title` | The card's name. |
| `stage` | The card's stage, if it has one. |
| `issuerTier` | `trusted` (the person trusts this issuer), `unknown` (they let the card in but don't trust the issuer, or stopped trusting it), or `canonical` / `ai-assessed` (issuers built into the card engine; Album has none yet). |
| `issuerLabel` | The person's name for the issuer. |
| `status` | `active`, `revoked`, `expired` or `unknown` (not yet checked against the issuer's withdrawn list). |
| `awardedAt` | When it was awarded, in seconds. |

Only cards that the person has let into their Album, whose signatures check, and that were given to one of the person's own card keys are ever reported.

An app never gets the person's card keys, their recovery words, what a card claims, their other cards, or anything that would let it prove a card is theirs to someone else.

## 1. The request

Send the person to:

```
https://jimbus9.github.io/album/#ask=<request>
```

where `<request>` is this JSON, UTF-8, in base64url without padding:

```json
{
  "v": 1,
  "app": "Grimoire OS",
  "return": "https://jimbus9.github.io/grimoire-os/",
  "slugs": ["first-lock", "founding-member"],
  "issuers": ["<64-character hex public key>"],
  "state": "<random, 8 to 128 characters of A-Z a-z 0-9 _ ->"
}
```

- `app`: the app's name as the person knows it, 1 to 24 characters.
- `return`: where Album sends the person back. Must be `https`, or `http` on `localhost`. No user name or password in it. Anything after `#` is dropped.
- `slugs`: the card handles the app wants, 1 to 200, each up to 64 characters, no repeats.
- `issuers` (optional): only cards signed by these issuer keys are reported. **Use it.** A handle like `founding-member` means nothing on its own: any issuer can make a card with that handle. Name the issuers whose cards count for your app.
- `state`: a fresh random string for each request. Album sends it back unchanged. Keep it (the helper uses `sessionStorage`) and refuse any answer that doesn't carry it.

## 2. What the person sees

Album opens (after its fingerprint, face or passcode). It shows:

- the app's name, **and the site it will send the answer to**: the return address's site and first folder, e.g. `jimbus9.github.io/grimoire-os`. Album remembers the allowance under the name and that place together, so a page elsewhere can't use another app's name to pick up its allowance.
- which of the asked-for cards the person holds;
- what the app will and won't see.

They choose **Show it these cards** or **Don't show it**.

If the person has already allowed that app (same name, same place) to see all the asked-for handles, Album answers straight away without asking again. They can stop an app at any time under Apps in Album; it then has to ask again.

## 3. The answer

Album sends the person to the return address with:

```
<return>#album-answer=<answer>
```

where `<answer>` is JSON in base64url:

```json
{ "v": 1, "state": "<the same state>", "ok": true, "cards": [ { "cardId": "…", "slug": "first-lock", "title": "First Lock", "issuerTier": "trusted", "issuerLabel": "The Kop Fund", "status": "active", "awardedAt": 1795000000 } ] }
```

or, if the person said no:

```json
{ "v": 1, "state": "<the same state>", "ok": false, "reason": "declined" }
```

An empty `cards` list means the person allowed it and holds none of the cards asked for.

On the return page: read the answer, **check `state`**, then remove the answer from the address (the helper's `readAlbumAnswer()` does all three) so it doesn't stay in the browser's history.

A request Album can't read (bad JSON, a non-https return address, no `state`) gets no answer at all: Album says what was wrong and sends nothing anywhere.

## What the answer is, and isn't

The answer is Album's word, carried by the person's own browser. It's right for an app that serves the person themselves (Grimoire filling in their own skill map). It is **not** proof to anyone else: the person could edit the address before it lands. An app that needs proof it can show to others needs a signed proof, which version 1 doesn't offer.

## Changes

A later version gets a new `v`. Album will keep answering version 1.
