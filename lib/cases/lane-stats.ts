/**
 * The seller's lane, timed from its own case records: how long from PayPal's webhook to the autopilot's argued
 * brief, its decision under the house rules, and the response going to PayPal (a filed fight or a refund), and how
 * many steps a person took on each case. Pure, so scripts/lane.ts can run it over the live API and the tests over
 * fixtures.
 */

export interface LaneCaseIn {
  id: string;
  reason: string;
  status: string;
  /** The case page's short outcome ("won", "filed", "refunded", ...). */
  where?: string | null;
  webhook: { receivedAt: string; arguedAt: string } | null;
  plan: { action: "evidence" | "accept" | "queue"; rule: number; decidedAt: string; done?: { at: string } | null; undone?: { at: string } | null } | null;
  filings: { at: string; action: string; ok?: boolean; by?: string; detail?: string }[];
}

export interface LaneRow {
  id: string;
  reason: string;
  status: string;
  where: string | null;
  /** What the autopilot decided under the house rules: file, refund, or leave it for the seller. */
  decided: "file" | "refund" | "left for the seller" | null;
  rule: number | null;
  /** Seconds from PayPal's webhook to the argued brief. */
  toArguedS: number | null;
  /** Seconds from PayPal's webhook to the autopilot's decision. */
  toDecidedS: number | null;
  /** The response that went to PayPal first: a filed fight or a refund, who sent it, and when after the webhook. */
  sent: { what: "filed" | "refunded"; by: "autopilot" | "seller"; at: string; afterS: number } | null;
  /** Steps a person took on the case: a filing or refund the seller sent, a ruling asked for by hand, a stop in the undo window. */
  humanSteps: string[];
}

const secs = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 1000);

export function laneRow(c: LaneCaseIn): LaneRow {
  const hook = c.webhook?.receivedAt ?? null;
  const ok = c.filings.filter((f) => f.ok !== false);
  const humanSteps: string[] = [];
  for (const f of ok) {
    if (f.by === "seller" && f.action !== "ruling") humanSteps.push(`${f.action === "accept" ? "refunded" : f.action === "evidence" ? "filed" : f.action} by the seller`);
    if (f.action === "ruling" && !/by the autopilot/.test(f.detail ?? "")) humanSteps.push("ruling asked for by hand");
  }
  if (c.plan?.undone) humanSteps.push("stopped in the undo window");
  const first = ok
    .filter((f) => f.action === "evidence" || f.action === "accept")
    .sort((a, b) => a.at.localeCompare(b.at))[0];
  const sent =
    first && hook
      ? { what: first.action === "accept" ? ("refunded" as const) : ("filed" as const), by: first.by === "seller" ? ("seller" as const) : ("autopilot" as const), at: first.at, afterS: secs(hook, first.at) }
      : null;
  return {
    id: c.id,
    reason: c.reason,
    status: c.status,
    where: c.where ?? null,
    decided: c.plan ? (c.plan.action === "evidence" ? "file" : c.plan.action === "accept" ? "refund" : "left for the seller") : null,
    rule: c.plan?.rule ?? null,
    toArguedS: hook && c.webhook?.arguedAt ? secs(hook, c.webhook.arguedAt) : null,
    toDecidedS: hook && c.plan ? secs(hook, c.plan.decidedAt) : null,
    sent,
    humanSteps,
  };
}

/** The middle value (the mean of the two middle values for an even count), or null for none. */
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const mins = (s: number | null) => (s === null ? null : Math.round(s / 6) / 10);

export function laneSummary(rows: LaneRow[]) {
  const val = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);
  const sentBy = (what: "filed" | "refunded", by?: "autopilot" | "seller") => rows.filter((r) => r.sent?.what === what && (!by || r.sent.by === by));
  const medMin = (rs: LaneRow[]) => mins(median(val(rs.map((r) => r.sent?.afterS ?? null))));
  return {
    cases: rows.length,
    zeroHuman: rows.filter((r) => r.humanSteps.length === 0).length,
    oneHuman: rows.filter((r) => r.humanSteps.length === 1).length,
    moreHuman: rows.filter((r) => r.humanSteps.length > 1).length,
    decided: { file: rows.filter((r) => r.decided === "file").length, refund: rows.filter((r) => r.decided === "refund").length, left: rows.filter((r) => r.decided === "left for the seller").length },
    medianToArguedS: median(val(rows.map((r) => r.toArguedS))),
    medianToDecidedMin: mins(median(val(rows.map((r) => r.toDecidedS)))),
    // The response going to PayPal, filed or refunded, on every case that has one.
    sent: rows.filter((r) => r.sent).length,
    medianToSentMin: medMin(rows.filter((r) => r.sent)),
    filed: sentBy("filed").length,
    medianToFiledMin: medMin(sentBy("filed")),
    filedByAutopilot: sentBy("filed", "autopilot").length,
    medianToFiledByAutopilotMin: medMin(sentBy("filed", "autopilot")),
    filedBySeller: sentBy("filed", "seller").length,
    medianToFiledBySellerMin: medMin(sentBy("filed", "seller")),
    refunded: sentBy("refunded").length,
    medianToRefundedMin: medMin(sentBy("refunded")),
    refundedByAutopilot: sentBy("refunded", "autopilot").length,
    medianToRefundedByAutopilotMin: medMin(sentBy("refunded", "autopilot")),
    refundedBySeller: sentBy("refunded", "seller").length,
  };
}
