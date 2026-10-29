import type { DeskRow } from "@/lib/desk";
import { daysToDue } from "../../lib/format";

/** How the desk words a row, apart from the grid so it can be tested. No I/O, no React. */

type Clocked = Pick<DeskRow, "where" | "status" | "due">;

/**
 * Whether PayPal's deadline passed with no answer. The desk's "lapsed" stage says so directly; a case the
 * sandbox still lists as waiting on the seller after its due time is the same thing, since the sandbox never
 * closes those on its own.
 */
export function isMissed(r: Clocked, now = Date.now()): boolean {
  if ((r.where as string) === "lapsed") return true;
  return r.status === "WAITING_FOR_SELLER_RESPONSE" && !!r.due && new Date(r.due).getTime() < now;
}

/** The seller's live moves: waiting on the seller with the deadline still ahead. */
export const isLive = (r: Clocked, now = Date.now()) => r.where === "waiting" && !isMissed(r, now);

/** Days to the deadline, or minus the days since it passed: the one count every page uses (lib/format.ts). */
export { daysToDue };

/** "Today", "3 d", or "Missed 9 d ago": never "today" for a deadline that has already gone. */
export function dueWords(due: string, now = Date.now()): { text: string; days: number; missed: boolean } {
  const days = daysToDue(due, now);
  if (days < 0) return { text: `Missed ${-days} d ago`, days, missed: true };
  return { text: days === 0 ? "Today" : `${days} d`, days, missed: false };
}

/** What was filed, in two or three words; the full line stays in the cell's tooltip. */
export function shortFiled(r: Pick<DeskRow, "filed" | "source" | "where" | "status" | "due">, now = Date.now()): string {
  if (r.source === "probe") return "API probe";
  const f = r.filed;
  if (!f) {
    if (isMissed(r, now)) return "Not answered";
    return r.where === "lost" ? "Nothing in time" : "Nothing yet";
  }
  if (/^Accepted/i.test(f)) return "Refund accepted";
  if (/^Offered/i.test(f)) return "Offer made";
  if (/^Filed/i.test(f)) {
    // Exhibit's own filings always carry the brief's PDF; a filing read back from PayPal names its file.
    const pdf = /\(\d+ sentences?\)|\.pdf\b/i.test(f);
    return pdf ? "Evidence + PDF" : "Evidence";
  }
  return f.length > 28 ? `${f.slice(0, 26)}…` : f;
}

const CALL: Record<string, string> = { fight: "Fight", accept: "Refund", offer: "Offer" };

/** Who decided a case that is over, in two or three words for a desk cell. */
export const DECIDED_SHORT: Record<string, string> = {
  requested: "ruled at Exhibit's request",
  sandbox: "sandbox closed it on its own",
  deadline: "closed after the deadline",
  seller: "seller refunded",
};

/** The same, shorter, for the grid's call column. */
export const DECIDED_TINY: Record<string, string> = {
  requested: "ruled on request",
  sandbox: "sandbox closed it",
  deadline: "deadline passed",
  seller: "seller refunded",
};

const decided = (r: Pick<DeskRow, "where">) => r.where === "won" || r.where === "lost" || r.where === "refunded";

/**
 * Exhibit's call on a row. While a case is open the brief's evidence balance (how much of its tally favours the
 * seller) sits beside the call; once PayPal has decided, the figure goes and the row says who decided instead,
 * so a balance is never read as the odds of an outcome that is already known.
 */
export function callCell(r: Pick<DeskRow, "where" | "recommendation" | "odds" | "decidedBy">): { call: string | null; balance: number | null; note: string | null } {
  const call = r.recommendation ? (CALL[r.recommendation] ?? r.recommendation) : null;
  if (decided(r)) return { call, balance: null, note: r.decidedBy && r.where !== "refunded" ? DECIDED_SHORT[r.decidedBy] : null };
  return { call, balance: r.odds, note: null };
}

/** The same, in words for a phone card: "Fight, evidence balance 90%" or "Fight; sandbox closed it on its own". */
export function callWords(r: Pick<DeskRow, "where" | "recommendation" | "odds" | "decidedBy">): string | null {
  const c = callCell(r);
  if (!c.call) return c.note ? c.note.charAt(0).toUpperCase() + c.note.slice(1) : null;
  if (c.balance != null) return `${c.call}, evidence balance ${c.balance}%`;
  return c.note ? `${c.call}; ${c.note}` : c.call;
}
