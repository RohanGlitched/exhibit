/**
 * The one count of the desk, used by every page that prints its numbers: the strip above the desk, the home
 * page's stats and the desk grid's toolbar all read these from the same snapshot of rows (lib/desk.ts
 * deskSnapshot), so they agree and carry the same "as of" time. Pure and client-safe.
 */
import type { DeskRow } from "./desk";
import type { Stage } from "./cases/derive";

type Counted = Pick<DeskRow, "where" | "decidedBy" | "pooled" | "retired" | "source" | "due" | "amount" | "sentences" | "struck" | "filed"> &
  Partial<Pick<DeskRow, "withdrawn" | "askedFor" | "reason">>;

/** The shop's own cases: not pool stock waiting for a visitor, not retired stock, not build-day API probes. */
export const shopRows = <R extends Counted>(rows: R[]): R[] => rows.filter((r) => !r.pooled && !r.retired && r.source !== "probe");

export interface DeskCounts {
  waiting: number;
  reviewing: number;
  won: number;
  lost: number;
  /** Won and lost, split by who decided: PayPal at Exhibit's request, or the sandbox on its own. */
  wonAsked: number;
  wonByItself: number;
  lostAsked: number;
  lostByItself: number;
  /** Rulings Exhibit asked for that PayPal hasn't given yet, by the side asked for. */
  askedSeller: number;
  askedBuyer: number;
  /** Of those, unauthorised-transaction chargebacks: PayPal's sandbox takes the request but hasn't ruled on one yet. */
  askedUnauthorised: number;
  refunded: number;
  open: number;
  lapsed: number;
  soonest: string | null;
}

/** The strip above the desk: shop cases only, not the pool stock or build-day probes. */
export function deskCounts(rows: Counted[]): DeskCounts {
  const live = shopRows(rows);
  const n = (w: Stage[]) => live.filter((r) => w.includes(r.where)).length;
  const by = (w: Stage, asked: boolean) => live.filter((r) => r.where === w && (r.decidedBy === "requested") === asked).length;
  return {
    waiting: n(["waiting"]),
    reviewing: n(["filed", "reviewing"]),
    won: n(["won"]),
    lost: n(["lost"]),
    wonAsked: by("won", true),
    wonByItself: by("won", false),
    lostAsked: by("lost", true),
    lostByItself: by("lost", false),
    askedSeller: live.filter((r) => r.askedFor === "seller").length,
    askedBuyer: live.filter((r) => r.askedFor === "buyer").length,
    askedUnauthorised: live.filter((r) => r.askedFor && r.reason === "UNAUTHORISED").length,
    refunded: n(["refunded"]),
    open: n(["open"]),
    lapsed: n(["lapsed"]),
    // Only deadlines still ahead: a lapsed case has no deadline left to meet.
    soonest: live.filter((r) => r.due && r.where === "waiting").map((r) => r.due!).sort()[0] ?? null,
  };
}

export interface DeskTotals extends DeskCounts {
  /** The shop's cases on the desk. */
  cases: number;
  /** Of those, the ones Exhibit argued (a brief on record). */
  argued: number;
  sentences: number;
  /** Sentences the checker struck; a sentence withdrawn at a hearing is counted apart. */
  struck: number;
  withdrawn: number;
  /** Cases whose response is on file with PayPal (whatever happened since), and cases refunded. */
  filed: number;
  /** Money still in play: waiting on the seller with the deadline ahead, or filed and with PayPal. A missed deadline is not. */
  atStake: number;
  /** The part of it on the cases waiting on the seller (the "Your move" count), deadline ahead. */
  waitingAmount: number;
}

/** Every figure the home page and the desk print, from one set of rows. */
export function deskTotals(rows: Counted[]): DeskTotals {
  const shop = shopRows(rows);
  const argued = shop.filter((r) => r.sentences !== null);
  return {
    ...deskCounts(shop),
    cases: shop.length,
    argued: argued.length,
    sentences: argued.reduce((n, r) => n + (r.sentences ?? 0), 0),
    struck: argued.reduce((n, r) => n + (r.struck ?? 0), 0),
    withdrawn: argued.reduce((n, r) => n + (r.withdrawn ?? 0), 0),
    filed: shop.filter((r) => r.filed && !/^Accepted/.test(r.filed)).length,
    atStake: shop.filter((r) => r.where === "waiting" || r.where === "filed" || r.where === "open").reduce((n, r) => n + r.amount, 0),
    waitingAmount: shop.filter((r) => r.where === "waiting").reduce((n, r) => n + r.amount, 0),
  };
}
