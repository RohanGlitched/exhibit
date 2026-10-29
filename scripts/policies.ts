// What each policy keeps per 100 disputes, from the committed eval: data/proof.json's labelled main-set runs, each
// case's own disputed amount, and PayPal's $20 card chargeback fee (lib/impact.ts). No model calls.
//   npx tsx --conditions=react-server scripts/policies.ts      writes data/policies.json
//
// Assumptions, as /proof states them: a case labelled "fight" that is fought is kept, and one that is refunded is
// given up; a case labelled "refund" ends with the money back with the buyer whichever way it goes, so fighting it
// costs a response and wins nothing. Real representment wins less often than its label, so "kept" is the most
// each policy could keep. The fee page doesn't say the fee is waived on a win, so it is counted on every case.
import { readFileSync, writeFileSync } from "node:fs";

const { VARIANTS, evalCase } = await import("../lib/eval/variants.ts");
const { DISPUTE_FEE } = await import("../lib/impact.ts");

type Call = "fight" | "accept" | "offer";
interface Row {
  key: string;
  variant: string;
  label: "fight" | "accept";
  rules: { call: Call };
  strong: { call: Call };
  model: { call: Call } | null;
}
const proof = JSON.parse(readFileSync("data/proof.json", "utf8")) as { at: string; summary: { model: string }; runs: Row[] };
const runs = proof.runs.filter((r) => r.model);
const amountOf = (key: string) => {
  const [id, b] = key.split("#");
  return Number(evalCase(VARIANTS.find((v) => v.id === id)!, Number(b)).dispute.dispute_amount.value);
};

const POLICIES: { id: string; name: string; call: (r: Row) => Call }[] = [
  { id: "fight", name: "Always fight", call: () => "fight" },
  { id: "refund", name: "Always refund", call: () => "accept" },
  { id: "strong", name: "Stronger rules", call: (r) => r.strong.call },
  { id: "exhibit", name: "Exhibit (GPT-5.6, first run)", call: (r) => r.model!.call },
];

const per100 = (x: number) => Math.round((x * 100) / runs.length);
const disputed = runs.reduce((n, r) => n + amountOf(r.key), 0);
const winnable = runs.filter((r) => r.label === "fight").reduce((n, r) => n + amountOf(r.key), 0);

const table = POLICIES.map((p) => {
  let kept = 0;
  let givenUp = 0;
  let responses = 0;
  let wasted = 0;
  for (const r of runs) {
    const fight = p.call(r) === "fight";
    const amount = amountOf(r.key);
    if (fight) responses++;
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
  };
});

const out = {
  at: new Date().toISOString(),
  from: { file: "data/proof.json", measured: proof.at, model: proof.summary.model, runs: runs.length, fightLabels: runs.filter((r) => r.label === "fight").length },
  disputedUsdPer100: per100(disputed),
  winnableUsdPer100: per100(winnable),
  feePerCase: DISPUTE_FEE.card,
  table,
};
console.log(out);
writeFileSync("data/policies.json", JSON.stringify(out, null, 1));
console.log("wrote data/policies.json");
