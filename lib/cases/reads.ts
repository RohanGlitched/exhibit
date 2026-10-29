import type { Brief } from "./types";

/**
 * The drafter's reads through PayPal's Agent Toolkit (lib/cases/brief.ts): which tools it may call, how many, how a
 * read is cut down for the model, and the one line the case page shows. Pure, so the tests can import it.
 */

/** The toolkit tools the drafter may call before it writes: reads only, never a write. */
export const DRAFTER_READS = ["get_dispute", "get_shipment_tracking", "get_refund", "get_order"] as const;
/** At most this many toolkit reads per brief, over at most two turns, then write_brief is forced. */
export const MAX_READS = 3;

/** What a toolkit read answered, without PayPal's HATEOAS links, cut to a size the model reads cheaply. */
export function compactRead(v: unknown, max = 2500): string {
  const strip = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(strip) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== "links").map(([k, y]) => [k, strip(y)])) : x;
  const s = JSON.stringify(strip(v));
  return s.length > max ? `${s.slice(0, max)}…(cut)` : s;
}

/** One line for the case page: what the read showed. */
export function readSummary(tool: string, v: unknown): string {
  const o = (v ?? {}) as Record<string, any>;
  if (tool === "get_dispute")
    return [o.status, o.dispute_life_cycle_stage, o.dispute_amount?.value ? `$${o.dispute_amount.value}` : null, o.seller_response_due_date ? `respond by ${String(o.seller_response_due_date).slice(0, 10)}` : null].filter(Boolean).join(", ") || "dispute read";
  if (tool === "get_shipment_tracking") {
    const t = (o.trackers ?? []) as Record<string, any>[];
    return t.length ? t.map((x) => [x.carrier, x.tracking_number, x.status].filter(Boolean).join(" ")).join("; ") : "no tracker on file";
  }
  if (tool === "get_refund") return [o.status, o.amount?.value ? `$${o.amount.value}` : null].filter(Boolean).join(", ") || "refund read";
  if (tool === "get_order") return [o.status, o.purchase_units?.[0]?.amount?.value ? `$${o.purchase_units[0].amount.value}` : null].filter(Boolean).join(", ") || "order read";
  return "read";
}

export type ReadLog = NonNullable<Brief["toolkit"]>[number];
