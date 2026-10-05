import "server-only";
import { unstable_cache } from "next/cache";
import { listCases } from "./store";
import { listDisputes } from "./paypal/disputes";
import { caseContext } from "./cases/service";
import { checkSentence } from "./cases/verify";
import { exhibitText } from "./cases/exhibits";
import { scenario } from "./shop/scenarios";
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
    const rank = (c: (typeof cases)[number]) =>
      (c.scenarioId === "delivered" ? 4 : 0) + (c.filings.length ? 2 : 0) + (c.brief?.engine === "model" ? 1 : 0);
    const pick = cases.sort((a, b) => rank(b) - rank(a) || b.openedAt.localeCompare(a.openedAt))[0];
    if (!pick?.brief) return null;
    const ctx = await caseContext(pick.disputeId);
    const s = scenario(pick.scenarioId!);
    const brief = pick.brief;
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
        order: pick.invoiceId ?? null,
      },
      exhibits: ctx.exhibits,
      brief,
      filed: pick.filings.at(-1)?.at ?? null,
      status: ctx.dispute.status,
      strikeDemo,
    };
  },
  ["showcase-v2"],
  { revalidate: 300 },
);

/** Live numbers for the landing strip, from Exhibit's records and PayPal's dispute list. */
export const deskStats = unstable_cache(
  async () => {
    const [all, disputes] = await Promise.all([listCases(), listDisputes({ pageSize: 50, pages: 4 }).catch(() => [])]);
    const cases = all.filter((c) => !c.retired);
    const argued = cases.filter((c) => c.brief);
    // "On the desk": cases someone has taken or argued, the same rows the desk shows, not the pool stock.
    const onDesk = new Set(cases.filter((c) => c.claimedBy || c.brief).map((c) => c.disputeId));
    return {
      argued: argued.length,
      sentences: argued.reduce((n, c) => n + c.brief!.sentences.length, 0),
      struck: argued.reduce((n, c) => n + c.brief!.sentences.filter((s) => !s.kept).length, 0),
      filed: cases.filter((c) => c.filings.some((f) => f.ok)).length,
      atStake: disputes.filter((d) => onDesk.has(d.dispute_id) && d.status !== "RESOLVED").reduce((n, d) => n + Number(d.dispute_amount.value), 0),
    };
  },
  ["desk-stats-v2"],
  { revalidate: 120 },
);
