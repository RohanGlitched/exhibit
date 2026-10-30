/**
 * Words and order for the case page, derived from what the record holds: which hearing tab opens first and
 * what each tab is called, how a card-pressed objection is marked, when the drafter's toolkit reads happened,
 * what an outcome is worth after PayPal's fee, and the disclosure for re-created earlier orders. Pure, so the
 * tests can check the words against the records they come from. Safe to import from client components.
 */
import type { Hearing, Objection } from "./hearing";
import { hearingAnchor } from "./hearing-log";
import type { Brief, Exhibit } from "./types";
import { DISPUTE_FEE } from "../impact";
import { usd, utcDay } from "../format";

/** "23:00" or, with seconds, "23:00:14", in UTC. */
const clock = (iso: string | Date, secs = false) => new Date(iso).toISOString().slice(11, secs ? 19 : 16);

export interface HearingTab {
  at: string;
  /** The tab's title: which copy the reviewer read, or that it was heard again. */
  label: string;
  /** Held after Exhibit asked PayPal to rule: it played no part in the request. */
  afterRuling: boolean;
  /** A second hearing on the draft that no autopilot step rests on. */
  again: boolean;
}

export interface TabInput {
  hearings: Pick<Hearing, "at" | "source">[];
  /** When Exhibit asked the sandbox to rule (the latest ruling request PayPal took), if it has. */
  rulingAt?: string | null;
  /** PayPal has closed the case. */
  resolved?: boolean;
  /** Hearing anchors the autopilot's audit lines link to. */
  linked?: string[];
}

/**
 * The hearing tabs, in the order shown, and the one that opens first. A case whose ruling request followed a
 * hearing on PayPal's copy opens on that hearing; anything heard after the request goes last, under "Heard again
 * after the ruling". Otherwise the newest hearing comes first and opens. A second hearing on the draft that no
 * audit line rests on is "Heard again on the draft".
 */
export function hearingTabs(i: TabInput): { tabs: HearingTab[]; open: string | null } {
  const list = [...i.hearings].sort((a, b) => a.at.localeCompare(b.at));
  const linked = new Set(i.linked ?? []);
  const drafts = list.filter((h) => h.source === "draft");
  const anyDraftLinked = drafts.some((h) => linked.has(hearingAnchor(h)));
  const tabs = list.map((h): HearingTab => {
    const afterRuling = Boolean(i.rulingAt && h.at > i.rulingAt);
    const again =
      h.source === "draft" && drafts.length > 1 && (anyDraftLinked ? !linked.has(hearingAnchor(h)) : h !== drafts[0]);
    const label = afterRuling
      ? i.resolved
        ? "Heard again after the ruling"
        : "Heard again after the ruling request"
      : again
        ? "Heard again on the draft"
        : h.source === "paypal"
          ? "On the PDF PayPal holds"
          : "On the draft";
    return { at: h.at, label, afterRuling, again };
  });
  // Two or more tabs with the same name (a 2-of-3 panel on PayPal's copy, a repeated draft hearing) are numbered.
  const named = new Map<string, number>();
  for (const t of tabs) named.set(t.label, (named.get(t.label) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const t of tabs) {
    const n = named.get(t.label)!;
    if (n < 2) continue;
    const k = (seen.get(t.label) ?? 0) + 1;
    seen.set(t.label, k);
    t.label = `${t.label}, hearing ${k} of ${n}`;
  }
  const before = tabs.filter((t) => !t.afterRuling).reverse();
  const after = tabs.filter((t) => t.afterRuling);
  const followed = i.rulingAt ? list.filter((h) => h.source === "paypal" && h.at <= i.rulingAt!).at(-1) : null;
  return { tabs: [...before, ...after], open: followed?.at ?? before[0]?.at ?? after.at(-1)?.at ?? null };
}

/**
 * Why a case lists more than one hearing on the draft: which one the autopilot's decision rests on, and that the
 * others were asked for afterwards (from the case page, or by an assistant over MCP), not by the autopilot.
 */
export function draftHearingsNote(i: TabInput): string | null {
  const { tabs } = hearingTabs(i);
  const drafts = tabs.filter((t) => i.hearings.find((h) => h.at === t.at)?.source === "draft" && !t.afterRuling);
  if (drafts.length < 2) return null;
  const again = drafts.filter((t) => t.again).sort((a, b) => a.at.localeCompare(b.at));
  const used = drafts.find((t) => !t.again);
  const times = again.map((t) => `${clock(t.at)} UTC`);
  const list = times.length === 1 ? times[0] : `${times.slice(0, -1).join(", ")} and ${times.at(-1)}`;
  if (!used || !again.length) return null;
  const linkedUsed = (i.linked ?? []).includes(hearingAnchor(used));
  return linkedUsed
    ? `This case was heard ${drafts.length} times on the draft. The autopilot's decision rests on the hearing at ${clock(used.at)} UTC. It was heard again on the draft at ${list}, not by the autopilot: anyone can ask the reviewer to hear a draft again from this page, or over MCP.`
    : `This case was heard ${drafts.length} times on the draft: first at ${clock(used.at)} UTC, then again at ${list}.`;
}

/** The note under a card-pressed objection, so it isn't read as the reviewer's own. Null for the reviewer's own. */
export function pressedNote(o: Pick<Objection, "pressed">, all: { objection: Pick<Objection, "pressed"> }[]): string | null {
  if (!o.pressed) return null;
  return all.some((e) => !e.objection.pressed)
    ? "Put to proof from the requirements card, not raised by the reviewer."
    : "Put to proof from the requirements card; the reviewer raised no objection of its own.";
}

type Read = NonNullable<Brief["toolkit"]>[number] & { at?: string };

/**
 * When the drafter's toolkit reads happened. A read logged with its own time says it; older reads were logged
 * without one, so they are placed in the drafting window (the brief's finish time less its duration).
 */
export function readTimes(calls: Read[], brief: Pick<Brief, "createdAt" | "ms"> | null | undefined): { each: (string | null)[]; window: string | null } {
  const each = calls.map((c) => (c.at ? `${clock(c.at, true)} UTC` : null));
  if (each.every(Boolean) || !brief?.createdAt) return { each, window: null };
  const end = new Date(brief.createdAt);
  const start = new Date(end.getTime() - (brief.ms ?? 0));
  return { each, window: `${utcDay(end)}, between ${clock(start, true)} and ${clock(end, true)} UTC, while the brief was drafted` };
}

/** The status in a get_dispute read's summary ("UNDER_REVIEW, CHARGEBACK, $180.00"). */
const statusOf = (summary: string) => summary.match(/^([A-Z_]+)\b/)?.[1] ?? null;

const words = (s: string) => s.toLowerCase().replace(/_/g, " ");

/**
 * When the drafter's get_dispute and the autopilot's later read disagree on PayPal's status, say why: they were
 * read at different times, and PayPal moved the case in between.
 */
export function readsDiffer(calls: Read[], brief: Pick<Brief, "createdAt"> | null | undefined, later: { at: string; status: string | null } | null | undefined): string | null {
  const g = calls.find((c) => c.tool === "get_dispute" && c.ok);
  const drafted = g ? statusOf(g.summary) : null;
  if (!g || !drafted || !later?.status || drafted === later.status) return null;
  const at = g.at ?? brief?.createdAt;
  if (!at || later.at < at) return null;
  return `The drafter's get_dispute read ${words(drafted)}${drafted === "UNDER_REVIEW" ? ", before PayPal handed the case to the seller" : ""}. The autopilot read the case again at ${clock(later.at)} UTC, when PayPal showed it ${words(later.status)}; that later read is the one in the autopilot's lines above.`;
}

/**
 * What the outcome is worth, said the same way as the ledger: the disputed amount stays (or goes back), and
 * PayPal's fee is charged either way. `line` is the brief's "Outcome:" words; `net` the ledger's figure.
 */
export function outcomeMoney(where: string, amount: number, card: boolean): { line: string; net: number } | null {
  const fee = card ? DISPUTE_FEE.card : DISPUTE_FEE.paypal;
  const a = usd(amount);
  const f = usd(fee);
  if (where === "won") return { line: `won, the seller keeps the ${a}; ${usd(amount - fee)} after PayPal's ${f} fee, charged either way`, net: amount - fee };
  if (where === "lost") return { line: `lost, ${a} back to the buyer, and PayPal's ${f} fee`, net: -fee };
  if (where === "refunded") return { line: `refunded, ${a} back to the buyer, and PayPal's ${f} fee`, net: -fee };
  return null;
}

/**
 * The disclosure for a returning customer's earlier orders: re-created as sandbox card payments when the case
 * was opened, their ages from the store's checkout log. Shown on the case page, outside the PDF.
 */
export function priorPaymentsNote(
  prior: { ref: string; captureId: string; at: string }[] | null | undefined,
  exhibits: Pick<Exhibit, "id" | "kind" | "lines">[],
): string | null {
  if (!prior?.length) return null;
  const hist = exhibits.find((e) => e.kind === "history");
  const ages = new Map<string, string>();
  for (const l of hist?.lines ?? []) {
    const m = l.match(/^(\S+?), (\d+) days ago\b/);
    if (m) ages.set(m[1], m[2]);
  }
  const each = prior.map((p) => `${p.ref}${ages.has(p.ref) ? ` (${ages.get(p.ref)} days old in the store's log)` : ""}, capture ${p.captureId}`);
  const list = each.length === 1 ? each[0] : `${each.slice(0, -1).join("; ")} and ${each.at(-1)}`;
  const day = utcDay(prior.map((p) => p.at).sort()[0]);
  return `${prior.length === 1 ? "The earlier order" : `The ${prior.length} earlier orders`}${hist ? ` in Exhibit ${hist.id}` : ""} ${prior.length === 1 ? "was" : "were"} re-created as sandbox card payments on ${day}, the day this case was opened: ${list}. ${prior.length === 1 ? "Its age comes" : "Their ages come"} from the store's checkout log, not from PayPal: the ${prior.length === 1 ? "payment itself is" : "payments themselves are"} dated ${day}. A real seller's history would be months old in PayPal too.`;
}
