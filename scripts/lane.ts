// The seller's lane, timed from the desk's own records. Reads the public API (the case list, then each lane case's
// record with its webhook times, the autopilot's plan and every filing with who sent it), and writes data/lane.json.
// No model calls, no PayPal calls, nothing written anywhere but the file.
//   npx tsx scripts/lane.ts [--base https://exhibit-desk.vercel.app]
import { writeFileSync } from "node:fs";
import { laneRow, laneSummary, type LaneCaseIn } from "../lib/cases/lane-stats.ts";

const i = process.argv.indexOf("--base");
const BASE = (i > 0 ? process.argv[i + 1] : "https://exhibit-desk.vercel.app").replace(/\/$/, "");

const get = async (path: string) => {
  const r = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
};

const list = (await get("/api/cases")) as { at: string; rows: { id: string; tag: string | null }[] };
const ids = list.rows.filter((r) => r.tag === "Seller's lane").map((r) => r.id);
console.log(`${ids.length} lane cases of ${list.rows.length} on the desk`);
const cases: LaneCaseIn[] = [];
for (const id of ids) {
  const d = await get(`/api/cases/${encodeURIComponent(id)}`);
  const plan = d.house?.plan ?? null;
  cases.push({
    id: d.id,
    reason: d.reason,
    status: d.status,
    where: d.where ?? null,
    webhook: d.webhook?.receivedAt ? { receivedAt: d.webhook.receivedAt, arguedAt: d.webhook.arguedAt } : null,
    plan: plan ? { action: plan.action, rule: plan.rule, decidedAt: plan.decidedAt, done: plan.done ?? null, undone: plan.undone ?? null } : null,
    filings: (d.filings ?? []).map((f: LaneCaseIn["filings"][number]) => ({ at: f.at, action: f.action, ok: f.ok, by: f.by, detail: f.detail })),
  });
}
// Oldest first, as the lane received them.
const rows = cases.map(laneRow).sort((a, b) => (a.sent?.at ?? a.id).localeCompare(b.sent?.at ?? b.id));
const webhooks = cases.map((c) => c.webhook?.receivedAt).filter(Boolean).sort() as string[];
const out = {
  at: new Date().toISOString(),
  source: `${BASE}/api/cases and /api/cases/<id> (the desk's own records), read ${list.at}`,
  note:
    "The seller's lane is the shop's own PayPal sandbox disputes, opened on a schedule and worked by the autopilot under the house rules; there are no outside sellers. A seller's step is a filing or refund sent from the case page by the person working the desk, a ruling asked for by hand, or a stop in the undo window. Times run from PayPal's CUSTOMER.DISPUTE.CREATED webhook. House rule 4 holds every send for 10 minutes so a person can stop it, so the time to filed includes that window.",
  firstWebhook: webhooks[0] ?? null,
  lastWebhook: webhooks.at(-1) ?? null,
  summary: laneSummary(rows),
  rows,
};
console.log(JSON.stringify(out.summary, null, 1));
writeFileSync("data/lane.json", JSON.stringify(out, null, 1));
console.log("wrote data/lane.json");
