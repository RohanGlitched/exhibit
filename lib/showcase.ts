import "server-only";
import { unstable_cache } from "next/cache";
import { listCases } from "./store";
import { deskCounts, deskRows } from "./desk";
import { caseContext } from "./cases/service";
import { checkSentence } from "./cases/verify";
import { exhibitText } from "./cases/exhibits";
import { reasonLabel, usd } from "./format";
import { followedReviewer, ruledAt, rulingRequestOf, type DecidedBy } from "./cases/derive";
import { showcaseRank } from "./showcase-rank";
import { untouched } from "./cases/pool";
import type { Brief, BriefSentence, Exhibit } from "./cases/types";

export interface Showcase {
  head: { id: string; reason: string; amount: string; buyer: string | null; order: string | null };
  exhibits: Exhibit[];
  brief: Brief;
  filed: string | null;
  status: string;
  /** How PayPal decided the shown case, and who decided it: ruled at Exhibit's request, or closed by the sandbox on its own. */
  ruling: { where: "won" | "lost"; at: string | null; by: DecidedBy | null; reviewer: boolean } | null;
  strikeDemo: { original: BriefSentence; altered: BriefSentence } | null;
}

/** Variants of a sentence with its first date moved by a few days, so the checker has something false to catch. */
function shiftedDates(text: string): string[] {
  const m = text.match(/\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})\b/);
  if (!m) return [];
  const d = Number(m[1]);
  return [2, -2, 3, -3, 5, -5]
    .map((k) => d + k)
    .filter((n) => n >= 1 && n <= 28)
    .map((n) => text.replace(m[0], `${n} ${m[2]} ${m[3]}`));
}

/**
 * The landing hero replays a real argued case: preferably the "delivered" story, filed with PayPal.
 * Cached for five minutes so the home page doesn't hit the sandbox on every visit.
 */
export const showcase = unstable_cache(
  async (): Promise<Showcase | null> => {
    // Where each case stands, as the desk reads it from PayPal: the hero never shows a case PayPal ruled
    // against the seller, or one whose deadline lapsed, and prefers one PayPal ruled for them.
    const rows = await deskRows(null).catch(() => []);
    const where = new Map(rows.map((r) => [r.id, r.where]));
    const decided = new Map(rows.map((r) => [r.id, r.decidedBy]));
    const cases = (await listCases()).filter(
      (c) =>
        c.brief &&
        c.scenarioId &&
        // Pool stock nobody has touched (waiting for a visitor, or retired unused) isn't on the desk; a case
        // someone filed is, whoever argued it.
        !untouched(c) &&
        !["lost", "lapsed"].includes(where.get(c.disputeId) ?? ""),
    );
    // A win PayPal ruled at Exhibit's request after a contested hearing first, then any requested win, then a
    // win the sandbox closed itself, then the "delivered" story, filed, argued by the model (lib/showcase-rank.ts).
    // The checker demo needs a dated sentence.
    const rank = (c: (typeof cases)[number]) =>
      showcaseRank({
        where: where.get(c.disputeId),
        decidedBy: decided.get(c.disputeId),
        scenarioId: c.scenarioId,
        filings: c.filings,
        engine: c.brief?.engine,
        hearing: c.hearing,
      });
    const pick = cases.sort((a, b) => rank(b) - rank(a) || b.openedAt.localeCompare(a.openedAt))[0];
    if (!pick?.brief) return null;
    const ctx = await caseContext(pick.disputeId);
    const s = ctx.scenario;
    const brief = ctx.brief ?? pick.brief;
    let strikeDemo: Showcase["strikeDemo"] = null;
    outer: for (const sentence of brief.sentences.filter((x) => x.kept)) {
      for (const altered of shiftedDates(sentence.text)) {
        const checked = checkSentence({ text: altered, cites: sentence.cites }, ctx.exhibits, exhibitText);
        if (!checked.kept) {
          strikeDemo = { original: sentence, altered: checked };
          break outer;
        }
      }
    }
    return {
      head: {
        id: pick.disputeId,
        reason: reasonLabel(ctx.dispute.reason),
        amount: usd(ctx.dispute.dispute_amount.value),
        buyer: s?.buyer.name ?? null,
        order: ctx.invoiceId ?? null,
      },
      exhibits: ctx.exhibits,
      brief,
      filed: ctx.filings.filter((f) => f.action === "evidence").at(-1)?.at ?? null,
      status: ctx.dispute.status,
      ruling:
        where.get(pick.disputeId) === "won"
          ? {
              where: "won",
              at: ruledAt(ctx.dispute),
              by: decided.get(pick.disputeId) ?? null,
              reviewer: followedReviewer(rulingRequestOf(ctx.filings, ruledAt(ctx.dispute))),
            }
          : null,
      strikeDemo,
    };
  },
  ["showcase-v6"],
  { revalidate: 300 },
);

/**
 * Live numbers for the landing strip: the same rows the desk shows (PayPal's dispute list, with what PayPal
 * holds as filed), and the briefs from Exhibit's records.
 */
export const deskStats = unstable_cache(
  async () => {
    // One base for every figure: the shop's cases Exhibit argued (a brief on record). Filings PayPal holds from
    // before Exhibit kept briefs, and cases nobody argued, are on the desk but not in these numbers.
    const rows = (await deskRows(null)).filter((r) => !r.pooled && !r.retired && r.source !== "probe");
    const argued = rows.filter((r) => r.sentences !== null);
    const c = deskCounts(argued);
    return {
      argued: argued.length,
      sentences: argued.reduce((n, r) => n + (r.sentences ?? 0), 0),
      struck: argued.reduce((n, r) => n + (r.struck ?? 0), 0),
      filed: argued.filter((r) => r.filed && !/^Accepted/.test(r.filed)).length,
      refunded: argued.filter((r) => r.filed && /^Accepted/.test(r.filed)).length,
      won: c.won,
      wonAsked: c.wonAsked,
      wonByItself: c.wonByItself,
      atStake: argued.filter((r) => r.where === "waiting" || r.where === "filed" || r.where === "open").reduce((n, r) => n + r.amount, 0),
    };
  },
  ["desk-stats-v4"],
  { revalidate: 120 },
);
