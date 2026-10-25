import type { DeskRow } from "@/lib/desk";

/** How the desk words a row, apart from the grid so it can be tested. No I/O, no React. */

type Clocked = Pick<DeskRow, "where" | "status" | "due">;

const DAY_MS = 86_400_000;

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

/**
 * Days to the deadline, counted up as the rest of Exhibit counts them (0 when under a day is left), or
 * days since it passed, as a negative number (-1 within a day of passing).
 */
export function daysToDue(due: string, now = Date.now()): number {
  const ms = new Date(due).getTime() - now;
  if (ms < 0) return -Math.ceil(-ms / DAY_MS);
  return ms < DAY_MS ? 0 : Math.ceil(ms / DAY_MS);
}

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
