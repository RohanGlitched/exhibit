import type { DeskRow } from "@/lib/desk";
import type { BriefSentence } from "@/lib/cases/types";
import type { SentenceState } from "@/lib/cases/sentence-state";
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

/** Where a row stands, in a word or two: "Refunded late" for a refund made after PayPal's deadline had passed. */
export const lateWord = (r: Pick<DeskRow, "where"> & Partial<Pick<DeskRow, "late">>) => (r.where === "refunded" && r.late ? "Refunded late" : null);

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

type Called = Pick<DeskRow, "where" | "recommendation" | "odds" | "decidedBy"> & Partial<Pick<DeskRow, "conceded">>;

/**
 * Exhibit's call on a row. While a case is open the brief's evidence balance (how much of its tally favours the
 * seller) sits beside the call; once PayPal has decided, the figure goes and the row says who decided instead,
 * so a balance is never read as the odds of an outcome that is already known. A case Exhibit conceded at the
 * hearing on PayPal's copy is called a refund from then on, whatever the filed brief said, with no balance.
 */
export function callCell(r: Called): { call: string | null; balance: number | null; note: string | null } {
  const call = r.conceded ? CALL.accept : r.recommendation ? (CALL[r.recommendation] ?? r.recommendation) : null;
  if (decided(r)) return { call, balance: null, note: r.decidedBy && r.where !== "refunded" ? DECIDED_SHORT[r.decidedBy] : null };
  if (r.conceded) return { call, balance: null, note: "conceded at the hearing" };
  return { call, balance: r.odds, note: null };
}

/** The same, in words for a phone card: "Fight, evidence balance 90%" or "Fight; sandbox closed it on its own". */
export function callWords(r: Called): string | null {
  const c = callCell(r);
  if (!c.call) return c.note ? c.note.charAt(0).toUpperCase() + c.note.slice(1) : null;
  if (c.balance != null) return `${c.call}, evidence balance ${c.balance}%`;
  return c.note ? `${c.call}; ${c.note}` : c.call;
}

/** How the desk can group its rows: not at all, by where each case stands, or by who decided it. */
export type GroupBy = "none" | "stage" | "decided";

/** A group's header row in the grid, full width: its name, how many cases and how much money. */
export interface GroupHead {
  kind: "group";
  id: string;
  key: string;
  label: string;
  count: number;
  amount: number;
}

/** A case's brief, opened under its row: one full-width row. */
export interface DetailRow {
  kind: "detail";
  id: string;
  caseId: string;
}

type Grouped = Pick<DeskRow, "id" | "where" | "status" | "due" | "decidedBy" | "amount" | "pooled"> & Partial<Pick<DeskRow, "late">>;

// Groups in reading order: the seller's live work first, then PayPal's queue, then what is over.
const STAGE_GROUPS: [string, string][] = [
  ["waiting", "Your move"],
  ["missed", "Missed PayPal's deadline"],
  ["open", "PayPal reviewing the chargeback"],
  ["filed", "Filed, PayPal reviewing"],
  ["won", "Won"],
  ["lost", "Lost"],
  ["refunded", "Refunded"],
  ["other", "Other"],
];
const DECIDED_GROUPS: [string, string][] = [
  ["undecided", "Not decided yet"],
  ["requested", "Ruled at Exhibit's request"],
  ["sandbox", "Closed by the sandbox on its own"],
  ["deadline", "Closed after the deadline passed"],
  ["seller", "Refunded by the seller"],
];

export const GROUP_LABELS: Record<Exclude<GroupBy, "none">, [string, string][]> = { stage: STAGE_GROUPS, decided: DECIDED_GROUPS };

/** The group a row falls in. */
export function groupKey(r: Grouped, by: Exclude<GroupBy, "none">, now = Date.now()): string {
  if (by === "decided") return r.decidedBy ?? "undecided";
  if (isMissed(r, now)) return "missed";
  if (r.where === "reviewing") return "open";
  return STAGE_GROUPS.some(([k]) => k === r.where) ? r.where : "other";
}

/**
 * The grid's rows in display order, from the cases in the order the grid sorted them: with grouping, each
 * group's header, then its cases in that order; any case whose brief is open is followed by its detail row.
 * Empty groups are left out. Used for the initial rows and again after every sort (AG Grid's postSortRows).
 */
export function arrange<R extends Grouped>(cases: R[], by: GroupBy, open: ReadonlySet<string>, now = Date.now()): (R | GroupHead | DetailRow)[] {
  const out: (R | GroupHead | DetailRow)[] = [];
  const push = (r: R) => {
    out.push(r);
    if (open.has(r.id)) out.push({ kind: "detail", id: `detail:${r.id}`, caseId: r.id });
  };
  if (by === "none") {
    cases.forEach(push);
    return out;
  }
  for (const [key, label] of GROUP_LABELS[by]) {
    const members = cases.filter((r) => groupKey(r, by, now) === key);
    if (!members.length) continue;
    out.push({ kind: "group", id: `group:${key}`, key, label, count: members.length, amount: members.reduce((n, r) => n + r.amount, 0) });
    members.forEach(push);
  }
  return out;
}

/**
 * Money opened per day over the last `days` UTC days, and the part of it still at stake now (waiting on the
 * seller with the deadline ahead, or filed and with PayPal): the desk's sparkline. Oldest day first.
 */
export function stakeByDay(
  rows: Pick<DeskRow, "opened" | "amount" | "where">[],
  now = Date.now(),
  days = 14,
): { day: string; opened: number; atStake: number }[] {
  const today = new Date(now).toISOString().slice(0, 10);
  const start = Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86_400_000;
  const out = Array.from({ length: days }, (_, i) => ({ day: new Date(start + i * 86_400_000).toISOString().slice(0, 10), opened: 0, atStake: 0 }));
  for (const r of rows) {
    const i = Math.floor((Date.parse(r.opened) - start) / 86_400_000);
    if (i < 0 || i >= days) continue;
    out[i].opened += r.amount;
    if (r.where === "waiting" || r.where === "filed" || r.where === "open") out[i].atStake += r.amount;
  }
  return out;
}

const BADGE: Record<string, string> = { struck: "Struck", withdrawn: "Withdrawn at the hearing", unverified: "Unverified", kept: "Kept" };

/** The checker's word on a sentence of an opened brief: the Community grid's brief rows and the Enterprise detail grid. */
export function sentenceWord(s: Pick<BriefSentence, "checked" | "cites" | "why">, st: SentenceState): string {
  if (st.kind === "checked") return `Checked: ${(s.checked ?? []).join(", ")}`;
  if (st.kind === "quoted") return `Quote matched in Exhibit ${st.exhibit ?? s.cites.join(" or ")}`;
  if (st.kind === "struck" && s.why) return `Struck: ${s.why}`;
  return BADGE[st.kind];
}

/** Who argued a brief, in words, from its engine. */
export const arguedBy = (engine: string | null | undefined) =>
  engine === "model" ? "argued by the model" : engine === "rules" ? "argued by the rules engine" : "read back from PayPal";

/** A quick filter over what a row shows: case id, buyer, reason and story. */
export function matchesQuick(r: Pick<DeskRow, "id" | "buyer" | "reason" | "story">, q: string, reasonLabel: (r: string) => string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return [r.id, r.buyer ?? "", reasonLabel(r.reason), r.story ?? ""].some((v) => v.toLowerCase().includes(t));
}
