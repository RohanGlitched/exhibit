/**
 * Every hearing a case has had, not just the latest. A record keeps `hearings` (oldest first) and, for older
 * readers, `hearing` as the latest; records saved before 30 Oct hold only `hearing`. Pure, so the tests can
 * reach it and the case page can link each audit line to the transcript it rests on.
 */
import type { Hearing } from "./hearing";

type Kept = { hearing?: Hearing; hearings?: Hearing[] };

/** At most this many hearings are kept on a record; the oldest go first (a draft hearing is never dropped for a re-run on PayPal's copy). */
export const HEARINGS_KEPT = 6;

/** Every hearing on a record, oldest first, one per time: `hearings` when it is there, else the single `hearing`. */
export function hearingsOf(r: Kept | null | undefined): Hearing[] {
  if (!r) return [];
  const all = [...(r.hearings ?? []), ...(r.hearing ? [r.hearing] : [])];
  const byAt = new Map<string, Hearing>();
  for (const h of all) if (h?.at) byAt.set(h.at, h);
  return [...byAt.values()].sort((a, b) => a.at.localeCompare(b.at));
}

/** The record with a new hearing added: kept in `hearings`, and as `hearing`, the latest. */
export function withHearing<R extends Kept>(r: R, h: Hearing): R & { hearing: Hearing; hearings: Hearing[] } {
  let list = [...hearingsOf(r).filter((x) => x.at !== h.at), h].sort((a, b) => a.at.localeCompare(b.at));
  // Over the cap, drop the oldest hearing on PayPal's copy first, then the oldest of any kind.
  while (list.length > HEARINGS_KEPT) {
    const i = list.findIndex((x) => x.source === "paypal" && x !== h);
    list = list.filter((_, k) => k !== (i >= 0 ? i : 0));
  }
  return { ...r, hearing: list.at(-1)!, hearings: list };
}

/** The latest hearing on the given copy (the draft, or the PDF PayPal holds), held at or before `at` when given. */
export function latestOn(hearings: Hearing[], source: Hearing["source"], at?: string | null): Hearing | null {
  return hearings.filter((h) => h.source === source && (!at || h.at <= at)).at(-1) ?? null;
}

/** The anchor a hearing's transcript sits under on the case page: "hearing-20261029T204049". */
export const hearingAnchor = (h: Pick<Hearing, "at">) => `hearing-${h.at.replace(/[-:]/g, "").slice(0, 15)}`;

/** The draft hearing a house decision rested on: held on the draft at or before the decision (a minute's grace for clocks). */
export function draftHearingFor(hearings: Hearing[], decidedAt: string): Hearing | null {
  const limit = new Date(new Date(decidedAt).getTime() + 60_000).toISOString();
  return latestOn(hearings, "draft", limit);
}
