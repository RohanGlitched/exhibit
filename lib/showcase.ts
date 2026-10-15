import "server-only";
import { unstable_cache } from "next/cache";
import { listCases } from "./store";
import { deskCounts, deskRows } from "./desk";
import { caseContext } from "./cases/service";
import { checkSentence } from "./cases/verify";
import { exhibitText } from "./cases/exhibits";
import { reasonLabel, usd } from "./format";
import type { Brief, BriefSentence, Exhibit } from "./cases/types";

export interface Showcase {
  head: { id: string; reason: string; amount: string; buyer: string | null; order: string | null };
  exhibits: Exhibit[];
  brief: Brief;
  filed: string | null;
  status: string;
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
    const cases = (await listCases()).filter((c) => c.brief && c.scenarioId && !c.retired);
    // The "delivered" story, filed, argued by the model, newest first; the checker demo needs a dated sentence.
    const rank = (c: (typeof cases)[number]) =>
      (c.scenarioId === "delivered" ? 4 : 0) + (c.filings.some((f) => f.action === "evidence") ? 2 : 0) + (c.brief?.engine === "model" ? 1 : 0);
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
      strikeDemo,
    };
  },
  ["showcase-v3"],
  { revalidate: 300 },
);

/**
 * Live numbers for the landing strip: the same rows the desk shows (PayPal's dispute list, with what PayPal
 * holds as filed), and the briefs from Exhibit's records.
 */
export const deskStats = unstable_cache(
  async () => {
    const rows = (await deskRows(null)).filter((r) => !r.pooled && !r.retired && r.source !== "probe");
    const argued = rows.filter((r) => r.sentences !== null);
    const c = deskCounts(rows);
    return {
      argued: argued.length,
      sentences: argued.reduce((n, r) => n + (r.sentences ?? 0), 0),
      struck: argued.reduce((n, r) => n + (r.struck ?? 0), 0),
      filed: rows.filter((r) => r.filed).length,
      won: c.won,
      atStake: rows.filter((r) => r.where === "waiting" || r.where === "filed" || r.where === "open").reduce((n, r) => n + r.amount, 0),
    };
  },
  ["desk-stats-v3"],
  { revalidate: 120 },
);
