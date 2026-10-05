import "server-only";
import { listDisputes, type DisputeSummary } from "./paypal/disputes";
import { listCases } from "./store";
import { scenario as findScenario } from "./shop/scenarios";
import type { CaseRecord, Recommendation } from "./cases/types";

export interface DeskRow {
  id: string;
  reason: string;
  amount: number;
  currency: string;
  status: string;
  stage: string;
  due: string | null;
  opened: string;
  updated: string;
  buyer: string | null;
  story: string | null;
  recommendation: Recommendation | null;
  odds: number | null;
  filed: string | null; // the last thing filed
  outcome: string | null;
  mine: boolean;
  pooled: boolean; // still in the house pool, not handed to anyone
}

export async function deskRows(visitor: string | null): Promise<DeskRow[]> {
  const [disputes, records] = await Promise.all([
    listDisputes({ pageSize: 50 }).catch(() => [] as DisputeSummary[]),
    listCases().catch(() => [] as CaseRecord[]),
  ]);
  const byId = new Map(records.map((r) => [r.disputeId, r]));
  // Only cases opened through Exhibit: the sandbox account also holds raw API test disputes with no story.
  return disputes.filter((d) => byId.has(d.dispute_id)).map((d) => {
    const r = byId.get(d.dispute_id);
    const s = r?.scenarioId ? findScenario(r.scenarioId) : undefined;
    const last = r?.filings.at(-1);
    return {
      id: d.dispute_id,
      reason: d.reason,
      amount: Number(d.dispute_amount.value),
      currency: d.dispute_amount.currency_code,
      status: d.status,
      stage: d.dispute_life_cycle_stage ?? "",
      due: d.seller_response_due_date ?? null,
      opened: d.create_time,
      updated: d.update_time,
      buyer: s?.buyer.name ?? null,
      story: s?.title ?? null,
      recommendation: r?.brief?.recommendation ?? null,
      odds: r?.brief?.odds ?? null,
      filed: last ? last.summary : null,
      outcome: d.outcome ?? null,
      mine: Boolean(visitor && r?.claimedBy === visitor),
      pooled: Boolean(r && !r.claimedBy && !r.brief),
    };
  });
}
