import type { Check, CheckId } from "./mandate";
import type { Responsibility } from "./types";

/**
 * What the cardholder told their shopping agent, read from the agent's log by code. Two things in that log
 * outweigh the mandate check:
 * - consent withdrawn before checkout ("Hold off for now... Don't buy anything yet"): a valid signed intent can't
 *   stand for an order the cardholder called off, so the agent platform answers for it and the seller refunds;
 * - an overage approved in writing ("Yes, get the set... Go ahead at $104"): the cart is outside the signed
 *   intent, but the cardholder agreed to exactly that cart, so the cardholder answers for it.
 * The last thing the cardholder said before the purchase decides. Pure, so the eval, the exhibits and the case
 * page read it the same way.
 */

/** A line of the agent's log that is a message to or from the cardholder. */
export const CONVERSATION = /\b(?:asked|ask|asking) the cardholder\b|^cardholder (?:replied|said|wrote|answered|responded)\b/i;

const SAID = /^cardholder (?:replied|said|wrote|answered|responded)\s*:?\s*(.*)$/i;
const WITHDRAW =
  /\b(?:hold off|don'?t buy|do not buy|don'?t order|do not order|don'?t go ahead|not yet|wait(?: for| until| a bit)?|stop|cancel(?: it| that| the order)?|never ?mind|changed my mind|don'?t purchase)\b/i;
const APPROVE = /\b(?:yes|go ahead|ok(?:ay)?|approved?|that'?s fine|is fine|buy it|get (?:it|the|that|them)|please (?:buy|order|get))\b/i;
const AMOUNT = /\$\s?\d[\d,]*(?:\.\d{2})?/;

export interface ConsentRead {
  /** The cardholder's last word before the purchase withdrew consent. */
  withdrawn: string | null;
  /** The cardholder's last word approved the purchase, with the amount they named, if any. */
  approved: { said: string; amount: string | null } | null;
}

export function readConsent(log: string[]): ConsentRead {
  let last: { said: string; kind: "withdraw" | "approve" } | null = null;
  for (const line of log) {
    const m = line.trim().match(SAID);
    if (!m) continue;
    const said = m[1].trim().replace(/^["“]|["”]$/g, "");
    // "Yes, but hold off until Friday" holds off; a plain yes approves.
    if (WITHDRAW.test(said)) last = { said, kind: "withdraw" };
    else if (APPROVE.test(said)) last = { said, kind: "approve" };
  }
  if (!last) return { withdrawn: null, approved: null };
  return last.kind === "withdraw"
    ? { withdrawn: last.said, approved: null }
    : { withdrawn: null, approved: { said: last.said, amount: last.said.match(AMOUNT)?.[0] ?? null } };
}

/** What a written approval can cover: the price and the item the agent asked about, never a bad signature or another address. */
const APPROVABLE: CheckId[] = ["total", "items"];

const money = (s: string) => Number(s.replace(/[^\d.]/g, ""));

export interface ConsentOverride {
  kind: "withdrawn" | "approved";
  said: string;
  verdict: Responsibility;
}

/**
 * The verdict after the cardholder's own words: withdrawn consent makes a passing check the agent platform's
 * responsibility; a written approval of an overage makes a cart that broke only the price or item limit the
 * cardholder's. Anything else leaves the mandate check's verdict as it is (null).
 */
export function consentOverride(checks: Check[], verdict: Responsibility, log: string[], cartTotal: string): ConsentOverride | null {
  const c = readConsent(log);
  if (c.withdrawn) {
    if (verdict.party !== "cardholder") return null; // already not the cardholder's: nothing to override
    return {
      kind: "withdrawn",
      said: c.withdrawn,
      verdict: {
        party: "agent",
        label: "Buyer's agent platform",
        line: `The agent's log shows the cardholder withdrew consent before checkout (“${c.withdrawn}”) and the agent bought anyway. A signed intent can't stand for an order the cardholder called off: refund the cardholder, and recover the loss from the agent platform with its own log.`,
      },
    };
  }
  if (c.approved && verdict.party === "agent") {
    const failed = checks.filter((x) => !x.ok).map((x) => x.id);
    const covered = failed.length > 0 && failed.every((id) => APPROVABLE.includes(id));
    // An amount the cardholder named has to cover what was charged.
    const enough = c.approved.amount === null || money(c.approved.amount) >= money(cartTotal);
    if (!covered || !enough) return null;
    return {
      kind: "approved",
      said: c.approved.said,
      verdict: {
        party: "cardholder",
        label: "Cardholder",
        line: `The cart is outside the signed intent, but the agent asked first and the cardholder approved it in writing (“${c.approved.said}”): the cardholder authorised this exact cart.`,
      },
    };
  }
  return null;
}
