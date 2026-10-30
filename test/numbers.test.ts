import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

// Every headline figure in the README (and, when it sits beside the repo, the Devpost paste file) must be the one
// committed in data/proof.json and data/policies.json. Re-run an eval and this fails until the copy is updated.
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const proof = JSON.parse(read("../data/proof.json")) as { summary: Record<string, number> };
const policies = JSON.parse(read("../data/policies.json")) as {
  secondPass: { unverified: number; kept: number; wordingMatched: number; neither: number };
  table: { id: string; keptUsd: number; responses: number }[];
  heldoutText: { table: { id: string; keptUsd: number }[] };
};
const s = proof.summary;
const n = (x: number) => x.toLocaleString("en-US");
const usd = (x: number) => `$${n(x)}`;
const exhibit = <R extends { id: string }>(t: R[]) => t.find((r) => r.id === "exhibit")!;

/** The figures a reader is told, each as the words that must appear. */
function figures() {
  const strong = policies.heldoutText.table.find((r) => r.id === "strong");
  return {
    main: `${s.modelCorrect} of ${s.modelRuns}`,
    text: `${s.modelCorrectOnText} of ${s.textRuns}`,
    records: `${s.modelCorrectOnRecord} of ${s.recordRuns}`,
    heldoutText: `${s.heldoutModelCorrectOnText} of ${s.heldoutTextRuns}`,
    mutations: `${n(s.mutationsStruck)} of ${n(s.mutations)}`,
    ownStruck: `${s.struckByChecker} of ${s.sentences}`,
    unverified: `${policies.secondPass.unverified} of ${policies.secondPass.kept}`,
    secondPass: `${policies.secondPass.wordingMatched} of ${policies.secondPass.unverified} match`,
    neither: `${policies.secondPass.neither} of ${policies.secondPass.kept}`,
    heldoutUsd: usd(exhibit(policies.heldoutText.table).keptUsd),
    heldoutStrongUsd: strong ? usd(strong.keptUsd) : null,
  };
}

test("the README's eval figures are the committed ones", () => {
  const readme = read("../README.md");
  const f = figures();
  for (const [name, words] of Object.entries(f)) {
    if (words === null || name === "heldoutUsd" || name === "heldoutStrongUsd") continue;
    assert.ok(readme.includes(words), `README should say "${words}" (${name})`);
  }
  assert.ok(!/56 of 56[^\n]{0,40}upper bound|upper bound[^\n]{0,40}56 of 56/.test(readme.split("History of that number")[0]), "the headline no longer calls 56 of 56 an upper bound");
});

test("the Devpost paste file, when it sits beside the repo, carries the committed figures", (t) => {
  const path = new URL("../../DEVPOST-UPDATE-2026-10-30.md", import.meta.url);
  if (!existsSync(path)) return t.skip("not beside the repo (CI)");
  const md = readFileSync(path, "utf8");
  const f = figures();
  for (const k of ["main", "heldoutText", "mutations", "heldoutUsd"] as const) assert.ok(md.includes(f[k]!), `DEVPOST-UPDATE should say "${f[k]}" (${k})`);
  if (f.heldoutStrongUsd) assert.ok(md.includes(f.heldoutStrongUsd), `DEVPOST-UPDATE should say "${f.heldoutStrongUsd}"`);
  assert.ok(!/56 of 56 (right calls|on the labelled main set), an upper bound/.test(md), "no stale upper-bound headline");
});
