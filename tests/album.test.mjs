import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { exampleStart } = require("../.test-build/examples.js");
const { viewCards, decks, importFile, removeCard } = require("../.test-build/engine/holder.js");
const { parseHolder } = require("../.test-build/engine/schema.js");
const { packCard, createDefinition, issueAward, generateKey } = require("../.test-build/engine/protocol.js");
const { cardLink, unwrapInput } = require("../.test-build/links.js");

// Everything here is synthetic and generated per run.
const NOW = "2026-01-01T12:00:00.000Z";

test("example cards: three in the Album, one waiting, all checkable", () => {
  const state = exampleStart(NOW);
  const views = viewCards(state, Date.parse(NOW));
  assert.equal(views.filter((v) => v.held.status === "held").length, 3);
  assert.equal(views.filter((v) => v.held.status === "quarantined").length, 1);
  assert.ok(views.every((v) => v.checks.signature === "valid" && v.checks.holderKey === "yours"));
  assert.equal(decks(views).length, 1);
  assert.deepEqual(parseHolder(JSON.parse(JSON.stringify(state))), state, "state survives saving and reopening");
});

test("a card link round-trips and imports the same card", () => {
  const issuer = generateKey();
  const holder = generateKey();
  const def = createDefinition(issuer.secretKey, "s", { title: "Synthetic", description: "D", category: "credential", issuerName: "Synthetic", collection: "C", criteria: "X", criteriaVersion: "1" }, 1);
  const award = issueAward(issuer.secretKey, def, holder.publicKey, { claim: "Synthetic claim" }, 1);
  const file = packCard(def, award);
  const link = cardLink("https://example.invalid/album/#old", file);
  assert.equal(unwrapInput(link), file);
  assert.equal(unwrapInput("  " + file + "  "), file);
  const state = exampleStart(NOW);
  const outcome = importFile(state, unwrapInput(link), NOW);
  assert.equal(outcome.kind, "quarantined", "unknown issuer waits");
});

test("a tampered card is refused and changes nothing", () => {
  const state = exampleStart(NOW);
  const held = state.cards[0];
  const tampered = packCard(held.definition, { ...held.award, content: held.award.content.replace("0042", "0001") });
  const fresh = removeCard(state, held.award.id);
  const outcome = importFile(fresh, tampered, NOW);
  assert.equal(outcome.kind, "rejected");
  assert.equal(outcome.state, fresh);
});
