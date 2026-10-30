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

// The hearing summary, the ruling panel and the seller's lane, wherever they are published beside the repo.
const review = JSON.parse(read("../data/review-proof.json")) as {
  summary: { hearings: number; overruled: number; overruledOnReviewer: number; sustained: number; pressedByCard: number };
  repeat: { fights: number; pairsAgree: number; majorityMatchesLabel: number };
};
const lane = JSON.parse(read("../data/lane.json")) as { summary?: Record<string, number> } & Record<string, unknown>;
const ls = (lane.summary ?? lane) as Record<string, number>;

function published() {
  const r = review.summary;
  const p = review.repeat;
  return {
    hearings: `${r.overruled} overruled`,
    hearingsAt: `${r.hearings} measured hearings`,
    reviewerOwn: `${r.overruledOnReviewer} `,
    sustained: `${r.sustained} `,
    panel: `${p.pairsAgree}`,
    panelOf: `${p.fights}`,
    lanes: `${ls.zeroHuman} of ${ls.cases}`,
  };
}

test("the hearing, panel and lane figures in the paste files beside the repo match the committed data", (t) => {
  const files = ["../../DEVPOST-UPDATE-2026-10-30.md", "../../video/youtube-v4.txt", "../../video/cards4.html"].map((f) => new URL(f, import.meta.url));
  const here = files.filter((f) => existsSync(f));
  if (!here.length) return t.skip("not beside the repo (CI)");
  const f = published();
  for (const file of here) {
    const text = readFileSync(file, "utf8");
    assert.ok(text.includes(f.hearings), `${file.pathname}: "${f.hearings}"`);
    if (!file.pathname.endsWith("cards4.html")) {
      assert.ok(text.includes(f.lanes), `${file.pathname}: lane "${f.lanes}" (data/lane.json)`);
      assert.ok(!/9 of 12\b/.test(text), `${file.pathname}: stale lane count "9 of 12"`);
    }
    assert.ok(!/1,039 of 1,056|1,015 of 1,051|56 of 56 right calls/.test(text), `${file.pathname}: a stale eval figure`);
  }
  const md = readFileSync(files[0], "utf8");
  assert.ok(md.includes(`first two hearings agreed on ${f.panel}`) && md.includes(`${f.panelOf} labelled fights`), "panel figures in DEVPOST-UPDATE");
  assert.ok(md.includes(`${review.summary.hearings} measured hearings`), "hearing count in DEVPOST-UPDATE");
});
