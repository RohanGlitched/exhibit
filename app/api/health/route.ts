import { NextResponse } from "next/server";
import { listDisputes, type DisputeSummary } from "@/lib/paypal/disputes";
import { listCases } from "@/lib/store";
import { storage } from "@/lib/storage";
import { llmModel, llmPing, llmReady } from "@/lib/llm";
import { POOL_PER_SCENARIO, lastRefill } from "@/lib/cases/open";
import { inPool, untouched } from "@/lib/cases/pool";
import { SCENARIOS } from "@/lib/shop/scenarios";
import { deadlineProblems, hoursSince, hoursUntil, readyForVisitor, refillProblem, READY_HOURS } from "@/lib/health";
import { readWebhookLog, webhookSummary } from "@/lib/webhooks/log";
import type { CaseRecord } from "@/lib/cases/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * What a judge's visit depends on, in one read: the house pool per story (is a ready case waiting, with 36 hours
 * or more to answer?), when the refill last ran, whether the model answers, the PayPal webhook log, and every
 * case close to or past a PayPal deadline. `ok` is false when any of those needs attention.
 * Public, read-only, no secrets: counts, case ids and times.
 */
export async function GET() {
  const t0 = Date.now();
  const [records, disputes, storeOk, refill, ping, hooks] = await Promise.all([
    listCases(true).catch(() => null as CaseRecord[] | null),
    listDisputes({ pageSize: 50, pages: 6 }).catch(() => null as DisputeSummary[] | null),
    storage()
      ? storage()!
          .read("index/cases.json")
          .then((r) => r !== null)
          .catch(() => false)
      : Promise.resolve(null),
    lastRefill().catch(() => null),
    llmPing().catch(() => null),
    readWebhookLog(),
  ]);
  const now = Date.now();
  const byId = new Map((disputes ?? []).map((d) => [d.dispute_id, d]));
  const pool = (records ?? []).filter(inPool);

  const stories = SCENARIOS.map((s) => {
    const stock = pool.filter((c) => c.scenarioId === s.id);
    const ready = stock.filter((c) => {
      const d = byId.get(c.disputeId);
      return readyForVisitor(d?.status, d?.seller_response_due_date, now);
    });
    const dues = ready.map((c) => byId.get(c.disputeId)?.seller_response_due_date).filter(Boolean) as string[];
    return {
      story: s.id,
      stock: stock.length,
      ready: ready.length,
      withPayPal: stock.filter((c) => ["OPEN", "UNDER_REVIEW"].includes(byId.get(c.disputeId)?.status ?? "")).length,
      target: POOL_PER_SCENARIO,
      soonestDueHours: dues.length ? Math.min(...dues.map((d) => hoursUntil(d, now))) : null,
    };
  });

  const newestStock = pool.map((c) => c.openedAt).sort().at(-1) ?? null;
  const oldestStock = pool.map((c) => c.openedAt).sort()[0] ?? null;
  // Every case still waiting on the seller within two days of PayPal's deadline, or already past it.
  const nearDeadline = (disputes ?? [])
    .filter((d) => d.status === "WAITING_FOR_SELLER_RESPONSE" && d.seller_response_due_date && hoursUntil(d.seller_response_due_date, now) < 48)
    .map((d) => {
      const r = (records ?? []).find((c) => c.disputeId === d.dispute_id);
      return {
        id: d.dispute_id,
        dueInHours: hoursUntil(d.seller_response_due_date!, now),
        kind: !r ? "not in Exhibit's store" : r.retired && untouched(r) ? "retired pool stock" : untouched(r) ? "pool stock" : "on the desk",
      };
    })
    .sort((a, b) => a.dueInHours - b.dueInHours);

  const problems: string[] = [];
  if (!disputes) problems.push("PayPal didn't answer the dispute list.");
  if (!records) problems.push("The case store didn't answer.");
  for (const s of stories) if (s.ready === 0) problems.push(`No ready case for "${s.story}" with ${READY_HOURS} hours or more to answer: a visitor would wait 5 to 8 minutes for PayPal.`);
  const refillLate = refillProblem(refill?.startedAt ?? null, now);
  if (refillLate) problems.push(refillLate);
  problems.push(...deadlineProblems(nearDeadline));
  if (llmReady() && ping && !ping.ok) problems.push(`The model didn't answer a ping (${ping.error ?? "no reply"}): briefs fall back to the rules engine.`);

  return NextResponse.json(
    {
      ok: problems.length === 0,
      at: new Date(now).toISOString(),
      ms: Date.now() - t0,
      problems,
      pool: {
        stories,
        stock: pool.length,
        oldestStockHours: oldestStock ? hoursSince(oldestStock, now) : null,
        newestStockHours: newestStock ? hoursSince(newestStock, now) : null,
        lastRefillAt: refill?.startedAt ?? null,
        lastRefill: refill,
      },
      nearDeadline,
      // Cases that missed PayPal's deadline: shown on the desk as missed, not a fault.
      missedDeadline: nearDeadline.filter((n) => n.dueInHours < 0).length,
      paypal: { reachable: Boolean(disputes), disputes: disputes?.length ?? null },
      webhooks: webhookSummary(hooks, now),
      store: { kind: storage() ? (process.env.GCS_BUCKET ? "gcs" : "blob") : "local", reachable: storeOk, records: records?.length ?? null },
      model: { configured: llmReady(), name: llmReady() ? llmModel() : null, ping },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
