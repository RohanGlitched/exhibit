import "server-only";
import { unstable_cache } from "next/cache";
import { getDispute, listDisputes, type Dispute, type DisputeSummary } from "./paypal/disputes";
import { listCases } from "./store";
import { scenario as findScenario, storyForSku } from "./shop/scenarios";
import { mergeFilings, paypalFilings, stageLine, stageOf, type Stage } from "./cases/derive";
import type { CaseRecord, Filing, Recommendation } from "./cases/types";

export interface DeskRow {
  id: string;
  reason: string;
  amount: number;
  currency: string;
  status: string;
  stage: string;
  where: Stage;
  whereLine: string;
  due: string | null;
  opened: string;
  updated: string;
  buyer: string | null;
  story: string | null;
  storyId: string | null;
  recommendation: Recommendation | null;
  odds: number | null;
  engine: string | null;
  struck: number | null; // sentences the checker struck
  sentences: number | null;
  filed: string | null; // the last thing filed
  filedAt: string | null;
  outcome: string | null;
  mine: boolean;
  pooled: boolean; // still in the house pool, not handed to anyone
  retired: boolean; // pool stock that went stale before anyone took it
  source: "exhibit" | "paypal" | "probe"; // Exhibit's record; rebuilt from PayPal's; a raw API probe from build day
}

/**
 * PayPal's detail for a case, cached by its update time: a case that hasn't changed is never read twice,
 * and one that has changes key. Only needed when Exhibit holds no filings to say what happened.
 */
const detail = (id: string, updated: string) =>
  unstable_cache(() => getDispute(id), ["dispute-detail", id, updated], { revalidate: 86_400 })();

async function pooled<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** Every dispute on the sandbox account, straight from the Disputes API, with Exhibit's notes where it has them. */
export async function deskRows(visitor: string | null): Promise<DeskRow[]> {
  const [disputes, records] = await Promise.all([
    listDisputes({ pageSize: 50, pages: 6 }).catch(() => [] as DisputeSummary[]),
    listCases().catch(() => [] as CaseRecord[]),
  ]);
  const byId = new Map(records.map((r) => [r.disputeId, r]));
  return pooled(disputes, 8, async (d): Promise<DeskRow> => {
    const r = byId.get(d.dispute_id);
    // What was filed: Exhibit's own note, else PayPal's record of the seller's evidence.
    let filings: Filing[] = r?.filings ?? [];
    let full: Dispute | null = null;
    const settled = filings.some((f) => f.action === "evidence" || f.action === "accept");
    if (!r?.scenarioId || ((d.status === "UNDER_REVIEW" || d.status === "RESOLVED") && !settled)) {
      full = await detail(d.dispute_id, d.update_time).catch(() => null);
      if (full) filings = mergeFilings(filings, paypalFilings(full));
    }
    const s = r?.scenarioId
      ? findScenario(r.scenarioId, { buyer: r.buyer ?? 0 })
      : /^HC-\d/.test(full?.disputed_transactions?.[0]?.invoice_number ?? "")
        ? storyForSku(full?.disputed_transactions?.[0]?.items?.[0]?.item_id, d.reason)
        : undefined;
    const merged = { ...d, ...(full ? { dispute_outcome: full.dispute_outcome, fund_movements: full.fund_movements } : {}) };
    const where = stageOf(merged, filings);
    const last = filings.filter((f) => f.action !== "ruling").at(-1);
    const buyerName = full?.disputed_transactions?.[0]?.buyer?.name;
    const exhibitCase = Boolean(r?.scenarioId || s);
    return {
      id: d.dispute_id,
      reason: d.reason,
      amount: Number(d.dispute_amount.value),
      currency: d.dispute_amount.currency_code,
      status: d.status,
      stage: d.dispute_life_cycle_stage ?? "",
      where,
      whereLine: stageLine(where, merged, filings),
      due: d.seller_response_due_date ?? null,
      opened: d.create_time,
      updated: d.update_time,
      buyer: r?.scenarioId ? (s?.buyer.name ?? null) : exhibitCase ? (buyerName ?? null) : null,
      story: s?.title ?? null,
      storyId: s?.id ?? null,
      recommendation: r?.brief?.recommendation ?? (last?.action === "accept" ? "accept" : last?.action === "evidence" ? "fight" : null),
      odds: r?.brief?.odds ?? null,
      engine: r?.brief?.engine ?? null,
      struck: r?.brief ? r.brief.sentences.filter((x) => !x.kept).length : null,
      sentences: r?.brief ? r.brief.sentences.length : null,
      filed: last ? last.summary : null,
      filedAt: last ? last.at : null,
      outcome: d.outcome ?? null,
      mine: Boolean(visitor && r?.claimedBy === visitor),
      pooled: Boolean(r && !r.claimedBy && !r.brief && !r.retired),
      retired: Boolean(r?.retired && !r.claimedBy && !r.brief),
      source: r && !r.restored ? "exhibit" : exhibitCase ? "paypal" : "probe",
    };
  });
}

export interface DeskCounts {
  waiting: number;
  reviewing: number;
  won: number;
  lost: number;
  refunded: number;
  open: number;
  soonest: string | null;
}

/** The strip above the desk: shop cases only, not the pool stock or build-day probes. */
export function deskCounts(rows: DeskRow[]): DeskCounts {
  const live = rows.filter((r) => !r.pooled && !r.retired && r.source !== "probe");
  const n = (w: Stage[]) => live.filter((r) => w.includes(r.where)).length;
  return {
    waiting: n(["waiting"]),
    reviewing: n(["filed", "reviewing"]),
    won: n(["won"]),
    lost: n(["lost"]),
    refunded: n(["refunded"]),
    open: n(["open"]),
    soonest: live.filter((r) => r.due && r.status === "WAITING_FOR_SELLER_RESPONSE").map((r) => r.due!).sort()[0] ?? null,
  };
}
