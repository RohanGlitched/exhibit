import "server-only";
import { unstable_cache } from "next/cache";
import { getDispute, listDisputes, type Dispute, type DisputeSummary } from "./paypal/disputes";
import { listCases } from "./store";
import { scenario as findScenario, storyForSku } from "./shop/scenarios";
import { decidedBy, mergeFilings, paypalFilings, refundedLate, ruledAt, stageLine, stageOf, type DecidedBy, type Stage } from "./cases/derive";
import { inPool, untouched } from "./cases/pool";
import type { CaseRecord, Filing, Recommendation } from "./cases/types";
import { oddsFor } from "./cases/verify";
import { checkerStrikes } from "./cases/autopilot";
import { hearingsOf } from "./cases/hearing-log";
import { briefCounts } from "./cases/sentence-state";

export { deskCounts, deskTotals, shopRows, type DeskCounts, type DeskTotals } from "./desk-counts";

/** The cache tag of the desk snapshot: a filing, a new case or a brief marks it stale at once. */
export const DESK_TAG = "desk";

export interface DeskRow {
  id: string;
  reason: string;
  amount: number;
  currency: string;
  status: string;
  stage: string;
  where: Stage;
  whereLine: string;
  /** Who decided a case that is over: PayPal at Exhibit's request, the sandbox on its own, the deadline, or the seller's refund. */
  decidedBy: DecidedBy | null;
  due: string | null;
  opened: string;
  updated: string;
  buyer: string | null;
  story: string | null;
  storyId: string | null;
  /** A short tag: the seller's own lane the autopilot works, or how an agent story's purchase was made. */
  tag: string | null;
  recommendation: Recommendation | null;
  odds: number | null;
  engine: string | null;
  struck: number | null; // sentences the checker struck (a sentence withdrawn at a hearing is not one)
  withdrawn: number | null; // sentences withdrawn at the hearing on the draft
  checks: number | null; // kept sentences matched to the record: figures and names, or a quote found verbatim
  sentences: number | null;
  /** Exhibit conceded at the hearing on PayPal's copy after filing: the call is a refund from then on. */
  conceded: boolean;
  /** Refunded after PayPal's deadline had passed with nothing filed. */
  late: boolean;
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
async function readDesk(lenient = false): Promise<{ rows: DeskRow[]; claimed: Record<string, string> }> {
  // A failed read throws, so the snapshot never caches a desk missing its records: the last good one is served
  // meanwhile. Only the uncached fallback (lenient) reads PayPal's list without Exhibit's records.
  const [disputes, records]: [DisputeSummary[], CaseRecord[]] = await Promise.all([
    listDisputes({ pageSize: 50, pages: 6 }),
    lenient ? listCases().catch(() => [] as CaseRecord[]) : listCases(),
  ]);
  const byId = new Map(records.map((r) => [r.disputeId, r]));
  // Who took each case from the pool stays on the server: the snapshot is shared, "mine" is set per visitor.
  const claimed = Object.fromEntries(records.filter((r) => r.claimedBy).map((r) => [r.disputeId, r.claimedBy!]));
  const rows = await pooled(disputes, 8, async (d): Promise<DeskRow> => {
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
        ? storyForSku(full?.disputed_transactions?.[0]?.items?.[0]?.item_id, d.reason, /^cart_/.test(full?.disputed_transactions?.[0]?.custom ?? ""))
        : undefined;
    const merged = { ...d, ...(full ? { dispute_outcome: full.dispute_outcome, fund_movements: full.fund_movements } : {}) };
    const where = stageOf(merged, filings);
    // When PayPal resolved it: its adjudication time when the detail was read, else the list's update time.
    const resolvedAt = d.status === "RESOLVED" ? ((full && ruledAt(full)) ?? d.update_time) : null;
    const last = filings.filter((f) => f.action !== "ruling").at(-1);
    const buyerName = full?.disputed_transactions?.[0]?.buyer?.name;
    const exhibitCase = Boolean(r?.scenarioId || s);
    // A concession at the hearing on PayPal's copy, held after the response was filed, turns the call to a refund.
    const filedAt = filings.filter((f) => f.action === "evidence").map((f) => f.at).sort().at(-1);
    const heard = hearingsOf(r).filter((h) => h.source === "paypal" && (!filedAt || h.at >= filedAt)).at(-1);
    const conceded = Boolean(filedAt && heard && heard.after !== "fight");
    const counts = r?.brief ? briefCounts(r.brief.sentences) : null;
    return {
      id: d.dispute_id,
      reason: d.reason,
      amount: Number(d.dispute_amount.value),
      currency: d.dispute_amount.currency_code,
      status: d.status,
      stage: d.dispute_life_cycle_stage ?? "",
      where,
      whereLine: stageLine(where, merged, filings, resolvedAt),
      decidedBy: decidedBy(where, filings, resolvedAt),
      due: d.seller_response_due_date ?? null,
      opened: d.create_time,
      updated: d.update_time,
      buyer: r?.scenarioId ? (s?.buyer.name ?? null) : exhibitCase ? (buyerName ?? null) : null,
      story: s?.title ?? null,
      storyId: s?.id ?? null,
      tag: r?.lane === "autopilot" ? "Seller's lane, autopilot" : s?.agent ? (r?.agent ? (r.agent.engine === "model" ? "Live buyer agent" : "Scripted agent, published keys") : "Script, stand-in key") : null,
      recommendation: conceded ? "accept" : (r?.brief?.recommendation ?? (last?.action === "accept" ? "accept" : last?.action === "evidence" ? "fight" : null)),
      odds: r?.brief && !conceded ? oddsFor(r.brief.recommendation, r.brief.odds) : null,
      engine: r?.brief?.engine ?? null,
      struck: r?.brief ? checkerStrikes(r.brief) : null,
      withdrawn: counts ? counts.withdrawn : null,
      checks: counts ? counts.checked : null,
      sentences: r?.brief ? r.brief.sentences.length : null,
      conceded,
      late: where === "refunded" && refundedLate(filings, d.seller_response_due_date),
      filed: last ? last.summary : null,
      filedAt: last ? last.at : null,
      outcome: d.outcome ?? null,
      mine: false,
      pooled: Boolean(r && inPool(r)),
      retired: Boolean(r?.retired && untouched(r)),
      source: r && !r.restored ? "exhibit" : exhibitCase ? "paypal" : "probe",
    };
  });
  return { rows, claimed };
}

/**
 * The desk as one snapshot, read from PayPal and the case store at most once a minute (and at once after a
 * filing, a new case or a brief, by DESK_TAG), with the time it was read. The desk, its strip, the home page's
 * figures, the analytics page and the MCP list all read it, so their numbers agree and say when they're from.
 */
const snapshot = unstable_cache(async () => ({ at: new Date().toISOString(), ...(await readDesk()) }), ["desk-snapshot-v1"], { revalidate: 60, tags: [DESK_TAG] });

export interface DeskSnapshot {
  at: string;
  rows: DeskRow[];
}

export async function deskSnapshot(visitor: string | null): Promise<DeskSnapshot> {
  const s = await snapshot().catch(async (e) => {
    console.error("desk snapshot", (e as Error).message);
    // Not cached: PayPal's list as it is now (without Exhibit's records if the store is down), or nothing.
    const now = new Date().toISOString();
    return readDesk(true)
      .then((d) => ({ at: now, ...d }))
      .catch(() => ({ at: now, rows: [] as DeskRow[], claimed: {} as Record<string, string> }));
  });
  return { at: s.at, rows: s.rows.map((r) => ({ ...r, mine: Boolean(visitor && s.claimed[r.id] === visitor) })) };
}

/** The snapshot's rows. */
export const deskRows = async (visitor: string | null): Promise<DeskRow[]> => (await deskSnapshot(visitor)).rows;
