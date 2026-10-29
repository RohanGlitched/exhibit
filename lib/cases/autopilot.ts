/**
 * The seller's house rules for the autopilot, and the decision they make on a case. Pure, so the tests (and the
 * case page) can reach it. The webhook argues every case the moment PayPal sends it; on the seller's own lane
 * (cases opened as the shop's traffic, not handed to visitors) the autopilot then transacts under these rules:
 * it refunds, files, or leaves the case for the seller, waits out an undo window, and asks for the ruling once
 * PayPal opens the case for one. Every step it takes is written on the case with the rule it acted under.
 */
import type { Hearing, Side } from "./hearing";
import type { Brief, Filing } from "./types";

export const HOUSE_RULES = {
  version: "v1, 29 Oct 2026",
  /** Refund on its own only below this amount (USD). */
  refundUnder: 150,
  /** File on its own only with at least this long left before PayPal's deadline. */
  minHoursLeft: 48,
  /** Nothing is sent to PayPal until this long after the decision; the seller can stop it on the case page. */
  undoMinutes: 10,
  rules: [
    { n: 1, text: "Refund on its own when the brief advises a refund, the simulated reviewer reading the draft agrees, and the amount is under $150." },
    { n: 2, text: "File the response on its own when the brief says fight, the checker struck no sentence, the hearing on the draft ends for the seller, and at least 48 hours remain before PayPal's deadline." },
    { n: 3, text: "Leave everything else for the seller, with the reason." },
    { n: 4, text: "Send nothing until 10 minutes after the decision; anyone working the desk can stop it on the case page in that time." },
    { n: 5, text: "Once PayPal opens a filed case for a ruling, ask for the ruling the hearing on PayPal's own copy of the filing reached." },
  ],
} as const;

export type HouseAction = "evidence" | "accept" | "queue";

export interface HousePlan {
  rules: string; // HOUSE_RULES.version it was decided under
  action: HouseAction;
  rule: 1 | 2 | 3;
  reason: string;
  decidedAt: string;
  /** Not sent before this time (the undo window). */
  sendAfter: string;
  /** The seller agent's read step, through PayPal's Agent Toolkit (get_dispute, get_shipment_tracking). */
  read?: { at: string; status: string | null; due: string | null; tracking: string | null; error?: string };
  /** The draft hearing the decision read. */
  hearing: { side: Side; objections: number; overruled: number; sustained: number; engine: Hearing["engine"] } | null;
  undone?: { at: string };
  done?: { at: string; summary: string };
  failed?: { at: string; error: string };
}

export interface DecideInput {
  brief: Pick<Brief, "recommendation" | "sentences">;
  hearing: Pick<Hearing, "verdict" | "after" | "exchanges" | "engine" | "source"> | null;
  amount: number;
  due: string | null;
  now: number;
}

/** Sentences the checker struck (a sentence withdrawn at the hearing on the draft is not a strike). */
export const checkerStrikes = (b: Pick<Brief, "sentences">) => b.sentences.filter((s) => !s.kept && !/^Withdrawn at the hearing/.test(s.why ?? "")).length;

export function decide(i: DecideInput): Pick<HousePlan, "action" | "rule" | "reason"> {
  const side = i.hearing?.verdict.side ?? null;
  const usd = (n: number) => `$${n.toFixed(2)}`;
  if (i.brief.recommendation === "accept") {
    if (!i.hearing) return { action: "queue", rule: 3, reason: "The brief advises a refund, but no hearing on the draft is on record to agree." };
    if (side !== "buyer") return { action: "queue", rule: 3, reason: "The brief advises a refund, but the simulated reviewer found for the seller: the seller should look." };
    if (i.amount >= HOUSE_RULES.refundUnder) return { action: "queue", rule: 3, reason: `The brief and the reviewer both say refund, but ${usd(i.amount)} is over the $${HOUSE_RULES.refundUnder} the house rules let the autopilot refund.` };
    return { action: "accept", rule: 1, reason: `The brief and the simulated reviewer both say refund, and ${usd(i.amount)} is under $${HOUSE_RULES.refundUnder}.` };
  }
  if (i.brief.recommendation !== "fight") return { action: "queue", rule: 3, reason: "The brief suggests an offer; offers are the seller's call." };
  const struck = checkerStrikes(i.brief);
  if (struck > 0) return { action: "queue", rule: 3, reason: `The checker struck ${struck} sentence${struck === 1 ? "" : "s"} of the brief.` };
  if (!i.brief.sentences.some((s) => s.kept)) return { action: "queue", rule: 3, reason: "No sentence of the response is left to file." };
  if (!i.hearing) return { action: "queue", rule: 3, reason: "No hearing on the draft is on record." };
  if (side !== "seller" || i.hearing.after !== "fight") return { action: "queue", rule: 3, reason: "The hearing on the draft ended for the buyer." };
  const hoursLeft = i.due ? (new Date(i.due).getTime() - i.now) / 3_600_000 : Infinity;
  if (hoursLeft < HOUSE_RULES.minHoursLeft) return { action: "queue", rule: 3, reason: `Only ${Math.max(0, Math.floor(hoursLeft))} hours remain before PayPal's deadline; the house rules want ${HOUSE_RULES.minHoursLeft}.` };
  return { action: "evidence", rule: 2, reason: "Nothing struck, the hearing on the draft ended for the seller, and the deadline is more than 48 hours away." };
}

/** The plan as it is saved on the case: the decision, the hearing it read, and the end of the undo window. */
export function planFor(i: DecideInput): HousePlan {
  const d = decide(i);
  const h = i.hearing;
  return {
    rules: HOUSE_RULES.version,
    ...d,
    decidedAt: new Date(i.now).toISOString(),
    sendAfter: new Date(i.now + (d.action === "queue" ? 0 : HOUSE_RULES.undoMinutes * 60_000)).toISOString(),
    hearing: h
      ? {
          side: h.verdict.side,
          objections: h.exchanges.length,
          overruled: h.exchanges.filter((e) => e.ruling === "overruled").length,
          sustained: h.exchanges.filter((e) => e.ruling === "sustained").length,
          engine: h.engine,
        }
      : null,
  };
}

/** Whether a plan is due to be sent now. */
export const planDue = (p: HousePlan | undefined, now: number) =>
  Boolean(p && p.action !== "queue" && !p.undone && !p.done && !p.failed && new Date(p.sendAfter).getTime() <= now);

/** Whether the undo window is still open. */
export const undoable = (p: HousePlan | undefined, now: number) => Boolean(p && p.action !== "queue" && !p.undone && !p.done && !p.failed && new Date(p.sendAfter).getTime() > now);

/**
 * A filed fight whose ruling the autopilot asks for: on the seller's lane as soon as PayPal opens it for one; on
 * any other case once it has waited this long, so a visitor can still ask for it themselves first.
 */
export const RULING_GRACE_HOURS = 2;
export function rulingDue(i: { lane: boolean; filings: Pick<Filing, "action" | "at" | "ok">[]; adjudicable: boolean; now: number }): boolean {
  if (!i.adjudicable) return false;
  if (i.filings.some((f) => f.action === "ruling" && f.ok !== false)) return false;
  const filed = i.filings.filter((f) => f.action === "evidence").map((f) => f.at).sort().at(-1);
  if (!filed) return false;
  return i.lane || i.now - new Date(filed).getTime() >= RULING_GRACE_HOURS * 3_600_000;
}

/** "41 s", "12 min", "3 h 5 min": how long after PayPal's webhook something happened. */
export function sinceWords(fromIso: string, toIso: string): string {
  const s = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000));
  if (s < 90) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** The stories the seller's lane opens, one a day in turn. */
export const LANE_STORIES = ["delivered", "agent-mandate", "untracked", "colour", "agent-overreach", "duplicate", "fraud"] as const;
export const laneStoryFor = (now: number) => LANE_STORIES[Math.floor(now / 86_400_000) % LANE_STORIES.length];

/** Why the toolkit's read and Exhibit's record disagree, or null when they agree (or the toolkit didn't answer). */
export function toolkitDisagrees(read: { dispute: { due: string | null } | null; tracking: { number: string } | null }, own: { due: string | null; tracking: string | null }): string | null {
  if (!read.dispute) return null;
  if (read.dispute.due && own.due && read.dispute.due.slice(0, 16) !== own.due.slice(0, 16))
    return `PayPal's Agent Toolkit reads the deadline as ${read.dispute.due}, Exhibit's record as ${own.due}; the seller should look before anything is sent.`;
  if (read.tracking && own.tracking && !read.tracking.number.includes(own.tracking))
    return `PayPal's Agent Toolkit reads tracking ${read.tracking.number}, Exhibit's record ${own.tracking}; the seller should look before anything is sent.`;
  return null;
}
