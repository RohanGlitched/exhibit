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
    what: "to answer a chargeback on PayPal. Miss it and the money stays with the buyer.",
    source: "PayPal, What is a chargeback",
    href: "https://www.paypal.com/us/brc/article/what-is-a-chargeback",
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
    href: "https://www.mastercard.com/ba/bs/novosti-i-trendovi/uvidi/2025/what-s-the-true-cost-of-a-chargeback-in-2025.html",
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
    writes: "You do: find the order, the tracking, the emails, and write it up in ten days",
    refund: "Up to you",
    proof: "Whatever you attach",
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
    proof: "Every amount, date, time and id checked against the record it cites; failures struck before filing",
  },
];

export const CHARGEFLOW_PRICING = { href: "https://www.chargeflow.io/pricing", checked: "15 Oct 2026" };
