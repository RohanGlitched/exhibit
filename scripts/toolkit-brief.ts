// One live-shaped brief with PayPal's Agent Toolkit reads, against a real sandbox dispute, read-only: the drafter
// (GPT-5.6) may call get_dispute, get_shipment_tracking, get_refund and get_order itself before write_brief.
// Nothing is filed and no store is read or written. Writes data/toolkit-brief.json with the calls and the cost.
//   npx tsx --conditions=react-server scripts/toolkit-brief.ts PP-R-GQZ-10195194 [--max-usd 0.04]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
// Never the shared store: the case is rebuilt from PayPal's own records alone.
for (const k of ["BLOB_READ_WRITE_TOKEN", "GCS_BUCKET", "GCS_SA_KEY", "GCS_WIF_AUDIENCE"]) delete process.env[k];

const id = process.argv[2] ?? "PP-R-GQZ-10195194";
const i = process.argv.indexOf("--max-usd");
const CAP = Number(i > 0 ? process.argv[i + 1] : 0.04);
const { caseContext } = await import("../lib/cases/service.ts");
const { argueWithModel } = await import("../lib/cases/brief.ts");
const { MAX_READS } = await import("../lib/cases/reads.ts");
const { llmModel, PRICE } = await import("../lib/llm.ts");

const ctx = await caseContext(id);
// The worst case before the call: two turns (one read turn and the forced write) and one shape retry, each
// about 4,000 tokens in and 1,500 out. The run doesn't start if that could pass the cap.
const worst = (3 * 4000 * PRICE.input + 3 * 1500 * PRICE.output) / 1e6;
console.log(`${id}: ${ctx.exhibits.length} exhibits; ${llmModel()}; worst case about $${worst.toFixed(3)}, cap $${CAP}`);
if (worst > CAP * 2) throw new Error("The worst case is more than twice the cap; raise --max-usd or lower the turns.");
const b = await argueWithModel(ctx.dispute, ctx.exhibits, { toolkit: true });
const usd = b.tokens ? (b.tokens.input * PRICE.input + b.tokens.output * PRICE.output) / 1e6 : null;
const out = {
  at: new Date().toISOString(),
  dispute: id,
  model: b.model ?? llmModel(),
  maxReads: MAX_READS,
  toolkit: b.toolkit ?? [],
  recommendation: b.recommendation,
  odds: b.odds,
  headline: b.headline,
  sentences: b.sentences.map((s) => ({ text: s.text, cites: s.cites, kept: s.kept, why: s.why ?? null })),
  ms: b.ms,
  tokens: b.tokens ?? null,
  priceIn: PRICE.input,
  priceOut: PRICE.output,
  usd: usd === null ? null : Number(usd.toFixed(4)),
};
console.log(JSON.stringify(out, null, 1));
writeFileSync("data/toolkit-brief.json", JSON.stringify(out, null, 1));
console.log("wrote data/toolkit-brief.json");
