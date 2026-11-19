import { emptyHolder, type HolderState } from "./engine/schema";
import { createDefinition, generateKey, issueAward, packCard, type CardDefinition } from "./engine/protocol";
import { acceptCard, addKey, importFile } from "./engine/holder";

/**
 * Example cards for trying Album. Every key is made fresh on this phone and every name says "Example".
 * Nothing here is a real card from a real issuer.
 */
const EXAMPLE_ISSUER = "Example issuer";
const base = {
  category: "credential" as const,
  issuerName: EXAMPLE_ISSUER,
  collection: "Example deck",
  criteriaVersion: "example-1",
};
const CARDS: { slug: string; definition: Omit<CardDefinition, keyof typeof base>; claim: string }[] = [
  { slug: "member", definition: { title: "Member", description: "You signed the example register.", criteria: "Sign the register." }, claim: "Member No. 0042" },
  { slug: "first-lock", definition: { title: "First Lock", description: "Your first lock reached the example register.", criteria: "Have a lock reach the register." }, claim: "First lock on the register" },
  { slug: "founding-member", definition: { title: "Founding Member", description: "One of the first 1,000 locks on the example register.", criteria: "Be among the first 1,000 locks." }, claim: "17 of 1,000" },
];

export function withExampleCards(state: HolderState, nowIso: string): HolderState {
  const now = Math.floor(Date.parse(nowIso) / 1000);
  const issuer = generateKey();
  const holder = generateKey();
  let next = addKey(state, EXAMPLE_ISSUER, holder, nowIso);
  CARDS.forEach((item, index) => {
    const definition = createDefinition(issuer.secretKey, item.slug, { ...base, ...item.definition }, now);
    const award = issueAward(issuer.secretKey, definition, holder.publicKey, { claim: item.claim }, now);
    const outcome = importFile(next, packCard(definition, award), nowIso);
    next = outcome.state;
    // The first card trusts the example issuer, so the rest go straight in.
    if (index === 0 && outcome.kind === "quarantined") next = acceptCard(next, outcome.id, nowIso, EXAMPLE_ISSUER);
  });
  // One card from an issuer you have not trusted, so you can see what waiting to be checked looks like.
  const stranger = generateKey();
  const strangerDefinition = createDefinition(
    stranger.secretKey,
    "ten-runs",
    { ...base, issuerName: "Example stranger", collection: "Example runs", title: "Ten Runs", description: "Ran ten times with the example club.", criteria: "Ten runs." },
    now,
  );
  const strangerAward = issueAward(stranger.secretKey, strangerDefinition, holder.publicKey, { claim: "Ten runs" }, now);
  return importFile(next, packCard(strangerDefinition, strangerAward), nowIso).state;
}

export const exampleStart = (nowIso: string) => withExampleCards(emptyHolder, nowIso);
