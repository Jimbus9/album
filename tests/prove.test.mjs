import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const p = require("../.test-build/prove.js");
const { exampleStart } = require("../.test-build/examples.js");

// Synthetic only.
const NOW = "2026-01-01T12:00:00.000Z";
const T = Math.floor(Date.parse(NOW) / 1000);

function setup(issuerHex = null) {
  const state = exampleStart(NOW);
  const card = state.cards.find((c) => c.status === "held" && c.definition.content.includes("Founding Member"));
  const request = p.makeRequest("Synthetic checker");
  const pending = [{ challenge: request.challenge, audience: request.audience, issuer: issuerHex, madeAt: T }];
  return { state, card, request, pending };
}

test("a request travels in a link and comes back the same", () => {
  const request = p.makeRequest("Synthetic checker", "founding-member");
  const link = p.requestLink("https://example.invalid/album/#x", request);
  assert.deepEqual(p.parseRequest(link.slice(link.indexOf("#"))), request);
  assert.equal(p.parseRequest("#prove=bad"), null);
  assert.equal(p.checkCode(request.challenge).length, 4);
});

test("a fresh proof from the holder checks out, once, and names the issuer", () => {
  const { state, card, request, pending } = setup();
  const made = p.makeProof(state, card.award.id, request, T);
  assert.ok(made.ok);
  for (const input of [p.proofText(made.bundle), p.proofLink("https://example.invalid/album/check.html", made.bundle)]) {
    const bundle = p.readProofInput("here you go: " + input);
    const result = p.checkProof(bundle, pending, T + 30);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.card.definition.title, "Founding Member");
    assert.equal(result.issuerMatches, null);
  }
});

test("the issuer key is checked when the checker gives one", () => {
  const a = setup();
  a.pending[0].issuer = a.card.award.pubkey;
  const proofA = p.makeProof(a.state, a.card.award.id, a.request, T).bundle;
  assert.equal(p.checkProof(proofA, a.pending, T).issuerMatches, true);
  const b = setup("0".repeat(64));
  const proofB = p.makeProof(b.state, b.card.award.id, b.request, T).bundle;
  assert.equal(p.checkProof(proofB, b.pending, T).issuerMatches, false);
});

test("old, stray, re-aimed or tampered proofs fail", () => {
  const { state, card, request, pending } = setup();
  const bundle = p.makeProof(state, card.award.id, request, T).bundle;
  assert.equal(p.checkProof(bundle, pending, T + 700).ok, false, "more than 10 minutes old");
  assert.equal(p.checkProof(bundle, [], T).ok, false, "a challenge this checker never gave");
  assert.equal(p.checkProof(bundle, [{ ...pending[0], audience: "Someone else" }], T).ok, false, "made for another checker");
  const forged = { ...bundle, award: { ...bundle.award, content: bundle.award.content.replace("17", "1") } };
  assert.equal(p.checkProof(forged, pending, T).ok, false, "card altered");
  // A proof made with a different key for the same card.
  const other = setup();
  const swapped = { ...bundle, proof: p.makeProof(other.state, other.card.award.id, request, T).bundle.proof };
  assert.equal(p.checkProof(swapped, pending, T).ok, false, "signed by someone who doesn't hold this card");
});
