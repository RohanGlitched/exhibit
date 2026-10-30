import type { RequirementsCard } from "../cases/requirements";

/**
 * American Express's own reason codes for the four reasons /import reads: C08 goods or services not received,
 * C31 not as described, F29 card not present fraud, P08 duplicate charge. Amex doesn't use Visa's or
 * Mastercard's numbers, so an Amex case is labelled with Amex's code, and the card says that the items under it
 * are the evidence Exhibit reads on that reason, not Amex's own list modelled item by item.
 */
export const AMEX_CODES: Record<string, { code: string; title: string }> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: { code: "C08", title: "Goods or services not received" },
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: { code: "C31", title: "Goods or services not as described" },
  UNAUTHORISED: { code: "F29", title: "Card not present fraud" },
  DUPLICATE_TRANSACTION: { code: "P08", title: "Duplicate charge" },
};

/** The card for an Amex case: Amex's own code and title, and a note on what the items are. */
export function amexCard(card: RequirementsCard | null, reason: string): RequirementsCard | null {
  const a = AMEX_CODES[reason];
  if (!card || !a) return card;
  const note = `${a.code} is American Express's own reason code. The items below are the evidence Exhibit reads on this reason for every card; Amex's own requirements aren't modelled item by item.`;
  return { ...card, network: "Amex", code: a.code, title: a.title, note: card.note ? `${card.note} ${note}` : note };
}
