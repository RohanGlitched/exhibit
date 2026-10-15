import { NextResponse } from "next/server";
import { listDisputes, type DisputeSummary } from "@/lib/paypal/disputes";
import { listCases } from "@/lib/store";
import { storage } from "@/lib/storage";
import { llmModel, llmReady } from "@/lib/llm";
import { POOL_PER_SCENARIO } from "@/lib/cases/open";
import { SCENARIOS } from "@/lib/shop/scenarios";
import type { CaseRecord } from "@/lib/cases/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const HOUR = 3_600_000;
const hoursUntil = (iso: string) => Math.round(((new Date(iso).getTime() - Date.now()) / HOUR) * 10) / 10;
const ageHours = (iso: string) => Math.round(((Date.now() - new Date(iso).getTime()) / HOUR) * 10) / 10;

/**
 * What a judge's visit depends on, in one read: the house pool per story (is a ready case waiting?), the
 * oldest stock, and every case close to a PayPal deadline. `ok` is false when a story has no case ready or
 * the pool hasn't been refilled in a day, which is what the hourly refill job is meant to prevent.
 * Public, read-only, no secrets: counts, case ids and times.
 */
export async function GET() {
  const t0 = Date.now();
  const [records, disputes, storeOk] = await Promise.all([
    listCases(true).catch(() => null as CaseRecord[] | null),
    listDisputes({ pageSize: 50, pages: 6 }).catch(() => null as DisputeSummary[] | null),
    storage()
      ? storage()!
          .read("index/cases.json")
          .then((r) => r !== null)
          .catch(() => false)
      : Promise.resolve(null),
  ]);
  const byId = new Map((disputes ?? []).map((d) => [d.dispute_id, d]));
  const pool = (records ?? []).filter((c) => !c.claimedBy && !c.brief && !c.retired);

  const stories = SCENARIOS.map((s) => {
    const stock = pool.filter((c) => c.scenarioId === s.id);
    const ready = stock.filter((c) => byId.get(c.disputeId)?.status === "WAITING_FOR_SELLER_RESPONSE");
    const dues = ready.map((c) => byId.get(c.disputeId)?.seller_response_due_date).filter(Boolean) as string[];
    return {
      story: s.id,
      stock: stock.length,
      ready: ready.length,
      withPayPal: stock.filter((c) => byId.get(c.disputeId)?.status === "OPEN").length,
      target: POOL_PER_SCENARIO,
      soonestDueHours: dues.length ? Math.min(...dues.map(hoursUntil)) : null,
    };
  });

  const newestStock = pool.map((c) => c.openedAt).sort().at(-1) ?? null;
  const oldestStock = pool.map((c) => c.openedAt).sort()[0] ?? null;
  // Any case still waiting on the seller within two days of PayPal's deadline: pool stock retires at 36 hours.
  const nearDeadline = (disputes ?? [])
    .filter((d) => d.status === "WAITING_FOR_SELLER_RESPONSE" && d.seller_response_due_date && hoursUntil(d.seller_response_due_date) < 48)
    .map((d) => {
      const r = (records ?? []).find((c) => c.disputeId === d.dispute_id);
      return {
        id: d.dispute_id,
        dueInHours: hoursUntil(d.seller_response_due_date!),
        kind: !r ? "not in Exhibit's store" : r.retired ? "retired pool stock" : !r.claimedBy && !r.brief ? "pool stock" : "on the desk",
      };
    })
    .sort((a, b) => a.dueInHours - b.dueInHours);

  const problems: string[] = [];
  if (!disputes) problems.push("PayPal didn't answer the dispute list.");
  if (!records) problems.push("The case store didn't answer.");
  for (const s of stories) if (s.ready === 0) problems.push(`No ready case for "${s.story}": a visitor would wait 5 to 8 minutes for PayPal.`);
  if (newestStock && ageHours(newestStock) > 24 && stories.some((s) => s.stock < s.target)) problems.push("The pool hasn't been refilled in a day.");
  for (const n of nearDeadline.filter((x) => x.kind === "pool stock" && x.dueInHours < 36)) problems.push(`${n.id} is pool stock inside 36 hours of its deadline and should have retired.`);

  return NextResponse.json(
    {
      ok: problems.length === 0,
      at: new Date().toISOString(),
      ms: Date.now() - t0,
      problems,
      pool: {
        stories,
        stock: pool.length,
        oldestStockHours: oldestStock ? ageHours(oldestStock) : null,
        newestStockHours: newestStock ? ageHours(newestStock) : null,
      },
      nearDeadline,
      paypal: { reachable: Boolean(disputes), disputes: disputes?.length ?? null },
      store: { kind: storage() ? (process.env.GCS_BUCKET ? "gcs" : "blob") : "local", reachable: storeOk, records: records?.length ?? null },
      model: { configured: llmReady(), name: llmReady() ? llmModel() : null },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
