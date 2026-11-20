import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const b = require("../.test-build/bridge.js");
const { toBase64Url, fromBase64Url } = require("../.test-build/links.js");
const { exampleStart } = require("../.test-build/examples.js");
const { revokePlug } = require("../.test-build/engine/plug.js");

// Synthetic only.
const NOW = "2026-01-01T12:00:00.000Z";
const ask = (x) => "#ask=" + toBase64Url(JSON.stringify(x));
const good = { v: 1, app: "Synthetic App", return: "https://example.invalid/synthetic-app/page#old", slugs: ["member", "founding-member"], state: "abcdefgh12345678" };

test("a good request is read, and remembered under name and place", () => {
  const parsed = b.parseAsk(ask(good));
  assert.ok(parsed.ok);
  assert.equal(parsed.request.place, "example.invalid/synthetic-app");
  assert.equal(parsed.request.app, "Synthetic App · example.invalid/synthetic-app");
  assert.equal(parsed.request.returnTo, "https://example.invalid/synthetic-app/page", "anything after # is dropped");
});

test("unsafe or broken requests are refused", () => {
  const bad = [
    { ...good, v: 2 },
    { ...good, return: "http://example.invalid/x" },
    { ...good, return: "javascript:alert(1)" },
    { ...good, return: "https://user:pw@example.invalid/" },
    { ...good, app: "" },
    { ...good, app: "x".repeat(25) },
    { ...good, slugs: [] },
    { ...good, slugs: ["a", "a"] },
    { ...good, slugs: ["a", 3] },
    { ...good, state: "short" },
    { ...good, issuers: ["not-hex"] },
  ];
  for (const x of bad) assert.equal(b.parseAsk(ask(x)).ok, false, JSON.stringify(x));
  assert.equal(b.parseAsk("#ask=%%%").ok, false);
  assert.ok(b.parseAsk(ask({ ...good, return: "http://localhost:4174/" })).ok, "localhost may use http");
});

test("nothing is answered until allowed; then only the asked-for cards from the named issuers", () => {
  const state = exampleStart(NOW);
  const { request } = b.parseAsk(ask(good));
  assert.equal(b.answerFor(state, request, Date.parse(NOW)).ok, false);
  assert.equal(b.alreadyAllowed(state, request), false);
  const allowed = b.allow(state, request, NOW);
  assert.ok(b.alreadyAllowed(allowed, request));
  const answer = b.answerFor(allowed, request, Date.parse(NOW));
  assert.ok(answer.ok);
  assert.deepEqual(answer.cards.map((c) => c.slug).sort(), ["founding-member", "member"]);
  assert.equal(answer.state, good.state);
  for (const card of answer.cards) assert.deepEqual(Object.keys(card).sort(), ["awardedAt", "cardId", "issuerLabel", "issuerTier", "slug", "status", "title"]);
  // Same name, different place: a different app, not allowed.
  const elsewhere = b.parseAsk(ask({ ...good, return: "https://elsewhere.invalid/synthetic-app/" })).request;
  assert.equal(b.alreadyAllowed(allowed, elsewhere), false);
  // Issuer filter.
  const issuer = allowed.cards.find((c) => c.status === "held").award.pubkey;
  const only = b.parseAsk(ask({ ...good, issuers: [issuer] })).request;
  assert.equal(b.answerFor(b.allow(state, only, NOW), only, Date.parse(NOW)).cards.length, 2);
  const other = b.parseAsk(ask({ ...good, issuers: ["0".repeat(64)] })).request;
  assert.equal(b.answerFor(b.allow(state, other, NOW), other, Date.parse(NOW)).cards.length, 0);
  // Stopping it.
  assert.equal(b.alreadyAllowed(revokePlug(allowed, request.app), request), false);
});

test("the answer address carries the answer after #album-answer=", () => {
  const { request } = b.parseAsk(ask(good));
  const address = b.answerAddress(request, b.declined(request));
  assert.ok(address.startsWith("https://example.invalid/synthetic-app/page#album-answer="));
  assert.deepEqual(JSON.parse(fromBase64Url(address.split("#album-answer=")[1])), { v: 1, state: good.state, ok: false, reason: "declined" });
});
