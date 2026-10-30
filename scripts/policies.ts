// What each policy keeps per 100 disputes, from the committed eval: data/proof.json's labelled main-set runs, each
// case's own disputed amount, and PayPal's $20 card chargeback fee (lib/impact.ts). No model calls.
//   npx tsx --conditions=react-server scripts/policies.ts      writes data/policies.json
//
// Assumptions, as /proof states them: a case labelled "fight" that is fought is kept, and one that is refunded is
// given up; a case labelled "refund" ends with the money back with the buyer whichever way it goes, so fighting it
// costs a response and wins nothing. Real representment wins less often than its label, so "kept" is the most
// each policy could keep. The fee page doesn't say the fee is waived on a win, so it is counted on every case.
//
// Also, all from the same saved answers and the case's own exhibits:
// - evidence completeness: of the fights each policy files, the share whose requirements card has every required
//   network item on file (lib/cases/requirements.ts, read by code), and the share with none missing;
// - the same per-100 table for the held-out set's free-text runs, where the model and the rules part ways;
// - a second pass over the sentences the checker kept as unverified: each one's own words against the text of the
//   exhibits it cites, and nothing else (lib/cases/wording.ts).
import { readFileSync, writeFileSync } from "node:fs";

const { VARIANTS, evalCase, withAgent } = await import("../lib/eval/variants.ts");
const { HELDOUT } = await import("../lib/eval/heldout.ts");
const { DISPUTE_FEE } = await import("../lib/impact.ts");
const { buildExhibits, exhibitText } = await import("../lib/cases/exhibits.ts");
const { requirementsFor } = await import("../lib/cases/requirements.ts");
const { wordingMatch, WORDING_SHARE } = await import("../lib/cases/wording.ts");
type Exhibit = import("../lib/cases/types.ts").Exhibit;

type Call = "fight" | "accept" | "offer";
interface Sentence {
  text: string;
  cites: string[];
  kept: boolean;
  unverified?: boolean;
}
interface Row {
  key: string;
  variant: string;
  label: "fight" | "accept";
  decidedBy?: "record" | "text";
  rules: { call: Call };
  strong: { call: Call };
  model: { call: Call; sentences?: Sentence[] } | null;
}
const proof = JSON.parse(readFileSync("data/proof.json", "utf8")) as {
  at: string;
  summary: { model: string; keptSentences: number; unverifiedSentences: number };
  main?: { at: string; prompt: string; rerun?: { at: string; keys: string[]; why: string | null } };
  runs: Row[];
  heldout: { at?: string; prompt?: string; runs: Row[] };
};

const variantOf = (id: string) => VARIANTS.find((v) => v.id === id) ?? HELDOUT.find((v) => v.id === id)!;
const cases = new Map<string, Awaited<ReturnType<typeof withAgent>>>();
const caseOf = async (key: string) => {
  if (!cases.has(key)) {
    const [id, b] = key.split("#");
    cases.set(key, await withAgent(evalCase(variantOf(id), Number(b))));
  }
  return cases.get(key)!;
};
const exhibitsOf = async (key: string): Promise<Exhibit[]> => {
  const c = await caseOf(key);
  return buildExhibits({ dispute: c.dispute, order: c.order, capture: c.capture, scenario: c.scenario, openedAt: c.openedAt, invoiceId: c.invoiceId, refund: c.refund, agent: c.agent });
};
const amountOf = async (key: string) => Number((await caseOf(key)).dispute.dispute_amount.value);
const standingOf = async (key: string) => {
  const c = await caseOf(key);
  return requirementsFor({ reason: c.dispute.reason, amount: c.dispute.dispute_amount.value }, await exhibitsOf(key))?.standing ?? null;
};

const POLICIES: { id: string; name: string; call: (r: Row) => Call }[] = [
  { id: "fight", name: "Always fight", call: () => "fight" },
  { id: "refund", name: "Always refund", call: () => "accept" },
  { id: "strong", name: "Stronger rules", call: (r) => r.strong.call },
  { id: "exhibit", name: "Exhibit (GPT-5.6)", call: (r) => r.model!.call },
];

async function tableFor(runs: Row[]) {
  const per100 = (x: number) => Math.round((x * 100) / runs.length);
  const amounts = new Map(await Promise.all(runs.map(async (r) => [r.key, await amountOf(r.key)] as const)));
  const standing = new Map(await Promise.all(runs.map(async (r) => [r.key, await standingOf(r.key)] as const)));
  const disputed = runs.reduce((n, r) => n + amounts.get(r.key)!, 0);
  const winnable = runs.filter((r) => r.label === "fight").reduce((n, r) => n + amounts.get(r.key)!, 0);
  const table = POLICIES.map((p) => {
    let kept = 0;
    let givenUp = 0;
    let responses = 0;
    let wasted = 0;
    let complete = 0;
    let noneMissing = 0;
    for (const r of runs) {
      const fight = p.call(r) === "fight";
      const amount = amounts.get(r.key)!;
      if (fight) {
        responses++;
        if (standing.get(r.key) === "met") complete++;
        if (standing.get(r.key) !== "not met") noneMissing++;
      }
      if (r.label === "fight") fight ? (kept += amount) : (givenUp += amount);
      else if (fight) wasted++;
    }
    return {
      id: p.id,
      name: p.name,
      keptUsd: per100(kept),
      givenUpUsd: per100(givenUp),
      responses: per100(responses),
      fightsOnRefundCases: per100(wasted),
      feesUsd: per100(runs.length * DISPUTE_FEE.card),
      netUsd: per100(kept - runs.length * DISPUTE_FEE.card),
      // Of the fights filed: every required network item on file, and none of them missing.
      fights: responses,
      completeFights: complete,
      completePct: responses ? Math.round((100 * complete) / responses) : null,
      noneMissingFights: noneMissing,
      noneMissingPct: responses ? Math.round((100 * noneMissing) / responses) : null,
    };
  });
  return { runs: runs.length, fightLabels: runs.filter((r) => r.label === "fight").length, disputedUsdPer100: per100(disputed), winnableUsdPer100: per100(winnable), table };
}

const runs = proof.runs.filter((r) => r.model);
const main = await tableFor(runs);
const heldText = proof.heldout.runs.filter((r) => r.model && r.decidedBy === "text");
const held = await tableFor(heldText);

// The second pass, on the same base as /proof's "kept, but unverified": the main and held-out model sentences.
const sentences = (await Promise.all(
  [...runs, ...proof.heldout.runs.filter((r) => r.model)].flatMap((r) =>
    (r.model!.sentences ?? []).filter((s) => s.kept).map(async (s) => ({ key: r.key, s, ex: await exhibitsOf(r.key) })),
  ),
));
const unverified = sentences.filter((x) => x.s.unverified);
const passes = unverified.map((x) => ({ key: x.key, text: x.s.text, cites: x.s.cites, ...wordingMatch(x.s.text, x.ex.filter((e) => x.s.cites.includes(e.id)), exhibitText) }));
const matched = passes.filter((p) => p.matched);
const secondPass = {
  threshold: WORDING_SHARE,
  kept: sentences.length,
  unverified: unverified.length,
  wordingMatched: matched.length,
  neither: unverified.length - matched.length,
  examples: {
    matched: matched.slice(0, 3).map((p) => ({ key: p.key, text: p.text, cites: p.cites, share: p.share })),
    unmatched: passes.filter((p) => !p.matched).slice(0, 3).map((p) => ({ key: p.key, text: p.text, cites: p.cites, share: p.share, missing: p.missing.slice(0, 6) })),
  },
};

const out = {
  at: new Date().toISOString(),
  from: {
    file: "data/proof.json",
    measured: proof.main?.at ?? proof.at,
    prompt: proof.main?.prompt ?? null,
    model: proof.summary.model,
    runs: main.runs,
    fightLabels: main.fightLabels,
    // Main runs re-run alone since (--update main --keys): which, when, and why; the rest are from `measured`.
    rerun: proof.main?.rerun ? { at: proof.main.rerun.at, keys: proof.main.rerun.keys, why: proof.main.rerun.why } : null,
  },
  disputedUsdPer100: main.disputedUsdPer100,
  winnableUsdPer100: main.winnableUsdPer100,
  feePerCase: DISPUTE_FEE.card,
  table: main.table,
  heldoutText: { measured: proof.heldout.at ?? proof.at, prompt: proof.heldout.prompt ?? null, ...held },
  secondPass,
};
console.log(JSON.stringify({ ...out, table: out.table.map((t) => [t.id, t.keptUsd, t.responses, t.completePct, t.noneMissingPct]), heldoutText: { ...held, table: held.table.map((t) => [t.id, t.keptUsd, t.givenUpUsd, t.responses, t.netUsd]) } }, null, 1));
writeFileSync("data/policies.json", JSON.stringify(out, null, 1));
console.log("wrote data/policies.json");
