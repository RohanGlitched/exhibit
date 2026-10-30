import { usd } from "../format";

/**
 * What a concession says to PayPal. On a card chargeback the issuer has already taken the money back, so promising
 * a refund invites a second one; the letter says the money stays where it is and nothing more is sent. Pure.
 */
export function concessionLetter(amount: string, card: boolean): string {
  return card
    ? `We accept the chargeback; the disputed ${usd(amount)} remains with the cardholder; no further refund will be issued.`
    : `We accept the claim; PayPal returns the disputed ${usd(amount)} to the buyer, and no further refund will be issued.`;
}
