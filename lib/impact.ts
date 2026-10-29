/**
 * The sourced numbers behind "why this matters", and the honest comparison with what a seller can use today.
 * Every figure links to where it was read (checked 15 Oct 2026). Shared by the home page and /proof.
 */

export interface Figure {
  value: string;
  what: string;
  source: string;
  href: string;
}

export const FIGURES: Figure[] = [
  {
    value: "10 days",
    what: "to answer each sandbox chargeback on this desk: the case opens with a ten-day response date, and PayPal returns it on the case as seller_response_due_date.",
    source: "Exhibit's sandbox chargebacks, lib/paypal/disputes.ts",
    href: "https://github.com/RohanGlitched/exhibit/blob/main/lib/paypal/disputes.ts",
  },
  {
    value: "$20",
    what: "PayPal's US settlement fee on a card chargeback, and $15 (or $30 at high volume) on a dispute paid through a PayPal account, on top of the sale itself.",
    source: "PayPal merchant fees, updated 1 Oct 2026",
    href: "https://www.paypal.com/us/business/paypal-business-fees",
  },
  {
    value: "$4.61",
    what: "what each $1 of fraud costs a US ecommerce merchant once fees, labour and lost goods are counted.",
    source: "LexisNexis True Cost of Fraud Study, Ecommerce and Retail, 2025",
    href: "https://risk.lexisnexis.com/about-us/press-room/press-release/20250402-tcof-ecommerce-and-retail",
  },
  {
    value: "261 million",
    what: "chargebacks worldwide in 2025, rising to 324 million a year by 2028.",
    source: "Mastercard, State of Chargebacks 2025 (research by Datos Insights)",
    href: "https://www.mastercard.com/sg/en/news-and-trends/Insights/2025/what-s-the-true-cost-of-a-chargeback-in-2025.html",
  },
];

export interface Option {
  name: string;
  cost: string;
  writes: string;
  refund: string;
  proof: string;
}

export const OPTIONS: Option[] = [
  {
    name: "PayPal Resolution Center",
    cost: "Free",
    writes: "You do: find the order, the tracking, the emails, and write it up before the response date",
    refund: "Up to you",
    proof: "Whatever you attach",
  },
  {
    name: "PayPal Seller Protection, and Chargeback Protection",
    cost: "Seller Protection: included on eligible sales. Chargeback Protection: 0.40% of each card sale (0.60% for Effortless), with Advanced Credit and Debit Card Payments only",
    writes: "Nobody: covered losses are absorbed, not argued. Every other case still needs a response",
    refund: "Every claim outside cover: not as described is never covered, ineligible sales aren't, and Seller Protection leaves out item-not-received claims filed with the card issuer. Chargeback Protection covers unauthorised and item-not-received chargebacks, the second only once you send the proof PayPal asks for",
    proof: "PayPal's decision on eligibility; nothing to check sentence by sentence",
  },
  {
    name: "Chargeback services (e.g. Chargeflow)",
    cost: "25% of every chargeback they win, plus PayPal's fee",
    writes: "Automated responses from your store data",
    refund: "Paid on wins, so the incentive is to fight",
    proof: "A response you can read, not a sentence-by-sentence trail",
  },
  {
    name: "Exhibit",
    cost: "Planned: free to argue, a flat $2 per response filed, no share of what you win",
    writes: "A brief from PayPal's records and your store's, pinned sentence by sentence",
    refund: "Says refund when the records say you'd lose, and files the acceptance",
    proof: "Every figure and name checked against the record it cites; failures struck before filing, sentences with nothing to check marked unverified",
  },
];

export const CHARGEFLOW_PRICING = { href: "https://www.chargeflow.io/pricing", checked: "15 Oct 2026" };

/** Where the Seller Protection / Chargeback Protection row was read (checked 30 Oct 2026). */
export const PROTECTION_SOURCES = [
  { label: "What is PayPal Seller Protection?", href: "https://www.paypal.com/us/cshelp/article/what-is-paypal-seller-protection-help156" },
  { label: "What is Chargeback Protection?", href: "https://www.paypal.com/us/cshelp/article/what-is-chargeback-protection-help608" },
  { label: "PayPal merchant fees (Chargeback Protection tools)", href: "https://www.paypal.com/us/business/paypal-business-fees" },
];

/** PayPal's fee on a dispute, from FIGURES: $20 on a card chargeback, $15 (standard) on one paid through a PayPal account. */
export const DISPUTE_FEE = { card: 20, paypal: 15 };
