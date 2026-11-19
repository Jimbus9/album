import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const v = require("../.test-build/vault.js");
const { emptyHolder } = require("../.test-build/engine/schema.js");
const { createDefinition, issueAward, packCard, generateKey } = require("../.test-build/engine/protocol.js");
const { importFile, viewCards } = require("../.test-build/engine/holder.js");

// Synthetic only. The words below are NIP-06's published test vector, not anyone's real words.
const VECTOR = "leader monkey parrot ring guide accident before fence cannon height naive bean";
const NOW = "2026-01-01T12:00:00.000Z";

function cardFor(holderPublicKey) {
  const issuer = generateKey();
  const def = createDefinition(issuer.secretKey, "s", { title: "Synthetic", description: "D", category: "credential", issuerName: "Synthetic issuer", collection: "C", criteria: "X", criteriaVersion: "1" }, 1);
  return packCard(def, issueAward(issuer.secretKey, def, holderPublicKey, { claim: "Synthetic claim" }, 1));
}

test("card keys follow NIP-06", () => {
  assert.equal(v.deriveKey(VECTOR, 0).secretKey, "7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a");
  assert.notEqual(v.deriveKey(VECTOR, 1).publicKey, v.deriveKey(VECTOR, 0).publicKey);
  assert.equal(v.findIndex(VECTOR, v.deriveKey(VECTOR, 7).publicKey), 7);
  assert.ok(v.wordsValid("  " + VECTOR.toUpperCase() + " "));
  assert.ok(!v.wordsValid(VECTOR.replace("bean", "beans")));
  assert.equal(v.newWords().split(" ").length, 12);
});

test("the vault opens only with its passcode", async () => {
  const { envelope } = await v.createVault(VECTOR, "synthetic-pass", emptyHolder);
  assert.ok(v.isStored(envelope));
  assert.equal(envelope.v, 2);
  assert.ok(!JSON.stringify(envelope).includes("leader"), "words are not stored in the clear");
  const opened = await v.unlockVault(envelope, "synthetic-pass");
  assert.equal(opened.vault.words, VECTOR);
  await assert.rejects(v.unlockVault(envelope, "wrong-pass"));
});

test("after a restore from the words, a card comes back as yours", async () => {
  const { unlocked } = await v.createVault(VECTOR, "synthetic-pass");
  const before = v.makeKey(v.makeKey(unlocked.vault, "First", NOW), "Second", NOW);
  const key = before.holder.keys[1];
  const file = cardFor(key.publicKey);
  // A fresh Album from the same words knows no keys yet.
  const fresh = (await v.createVault(VECTOR, "other-pass")).unlocked.vault;
  const recovered = v.recoverKeysFor(fresh, file, NOW);
  assert.equal(recovered.holder.keys.length, 1);
  assert.equal(recovered.holder.keys[0].secretKey, key.secretKey);
  assert.equal(recovered.nextIndex, 2, "new keys never reuse a recovered one");
  const outcome = importFile(recovered.holder, file, NOW);
  assert.equal(viewCards(outcome.state, Date.parse(NOW))[0].checks.holderKey, "yours");
  // A card for a key from other words is left alone.
  assert.equal(v.recoverKeysFor(fresh, cardFor(generateKey().publicKey), NOW), fresh);
});

test("a backup opens with the same words and no others", async () => {
  const { unlocked } = await v.createVault(VECTOR, "synthetic-pass");
  const vault = v.makeKey(unlocked.vault, "First", NOW);
  const file = await v.makeBackup(vault);
  assert.ok(!file.includes(vault.holder.keys[0].secretKey), "keys are not in the clear");
  const read = await v.readBackup(file, VECTOR);
  assert.ok(read.ok);
  assert.equal(read.holder.keys.length, 1);
  assert.equal(read.nextIndex, 1);
  const other = await v.readBackup(file, v.newWords());
  assert.equal(other.ok, false);
});

test("a passkey opens the vault too, and only its own output does", async () => {
  const { unlocked } = await v.createVault(VECTOR, "synthetic-pass");
  const prf = crypto.getRandomValues(new Uint8Array(32));
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const withKey = await v.addPasskey(unlocked, "c3ludGhldGlj", salt, prf);
  const envelope = await v.lockVault(withKey);
  assert.ok(envelope.passkey);
  const opened = await v.unlockWithPasskey(envelope, prf);
  assert.equal(opened.vault.words, VECTOR);
  await assert.rejects(v.unlockWithPasskey(envelope, crypto.getRandomValues(new Uint8Array(32))));
  assert.equal((await v.unlockVault(envelope, "synthetic-pass")).vault.words, VECTOR, "the passcode still works");
  assert.ok(await v.passcodeOpens(opened, "synthetic-pass"));
  assert.ok(!(await v.passcodeOpens(opened, "nope-nope")));
  const off = await v.lockVault(v.removePasskey(opened));
  assert.equal(off.passkey, undefined);
});

test("a version 1 vault opens with its passcode and comes back as version 2", async () => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", enc.encode("old-pass"), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 1000 }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const body = { v: 1, words: VECTOR, nextIndex: 3, holder: emptyHolder };
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(body))));
  const b = (x) => Buffer.from(x).toString("base64");
  const old = { v: 1, kdf: "pbkdf2-sha256", iterations: 1000, salt: b(salt), iv: b(iv), data: b(data) };
  assert.ok(v.isStored(old));
  const opened = await v.unlockVault(old, "old-pass");
  assert.equal(opened.vault.nextIndex, 3);
  const upgraded = await v.lockVault(opened);
  assert.equal(upgraded.v, 2);
  assert.equal((await v.unlockVault(upgraded, "old-pass")).vault.words, VECTOR);
});
