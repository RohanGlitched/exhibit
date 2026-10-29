/**
 * Two example inputs for /import, both made up: the shops, buyers, addresses, tracking numbers and emails are
 * invented (emails on example.com), and the page labels each one as made up. One is a not-received case with
 * delivered scans, pasted newest first as carriers list them; the other a not-as-described case where the buyer
 * declined a free return and kept the item. Safe to import from client code.
 */
import { emptyForm, type ImportForm } from "./input";

export interface Example {
  id: string;
  label: string;
  blurb: string;
  form: ImportForm;
}

function make(fill: (f: ImportForm) => void): ImportForm {
  const f = emptyForm();
  fill(f);
  return f;
}

export const EXAMPLES: Example[] = [
  {
    id: "delivered",
    label: "Not received, but delivered",
    blurb: "A candle order the carrier scanned as delivered at the buyer's door. The buyer says it never came.",
    form: make((f) => {
      f.order = {
        id: "1042",
        date: "2026-10-02 18:41",
        items: "2 × Beeswax taper candles, set of 6, $18.00\n1 × Brass candle holder, $26.00",
        total: "62.00",
        shipTo: "Jordan Avery, 2214 NE Alberta St, Portland, OR 97211",
        buyer: "Jordan Avery",
        email: "jordan.avery@example.com",
      };
      f.dispute = {
        reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
        network: "VISA",
        amount: "62.00",
        caseId: "EXAMPLE-NR-1042",
        paymentId: "",
        respondBy: "21 Oct 2026",
        claim: "The cardholder says the order never arrived.",
        last4: "4242",
      };
      f.shipping = {
        carrier: "USPS",
        tracking: "9400 1118 9922 3344 5566 77",
        onPayPal: true,
        scans: [
          "October 6, 2026, 2:14 pm\tDelivered, Front Door/Porch\tPORTLAND, OR 97211",
          "October 6, 2026, 7:02 am\tOut for Delivery\tPORTLAND, OR 97211",
          "October 5, 2026, 9:40 pm\tArrived at USPS Regional Facility\tPORTLAND OR DISTRIBUTION CENTER",
          "October 3, 2026, 4:55 pm\tUSPS picked up item\tSEATTLE, WA 98103",
        ].join("\n"),
      };
      f.emails = [
        "From: Jordan Avery <jordan.avery@example.com>",
        "Date: Oct 8, 2026, 10:12 AM",
        "Subject: Where is my order?",
        "",
        "Hi, my order 1042 never arrived. Can you check what happened?",
        "",
        "From: Me",
        "Date: Oct 8, 2026, 11:30 AM",
        "Subject: Re: Where is my order?",
        "",
        "Hi Jordan, USPS shows it delivered to your front door on October 6 at 2:14 pm. Could you check with your neighbours or building office? Tell me if it doesn't turn up.",
      ].join("\n");
    }),
  },
  {
    id: "kept",
    label: "Not as described, item kept",
    blurb: "A hand-dyed throw the buyer finds too light. The listing says the shade varies; the buyer turned down a free return.",
    form: make((f) => {
      f.order = {
        id: "2207",
        date: "6 Oct 2026",
        items: "1 × Hand-dyed linen throw, indigo, $128.00",
        total: "$140.00",
        shipTo: "Priya Natarajan, 88 Maple Ave, Apt 3B, Montclair, NJ 07042",
        buyer: "Priya Natarajan",
        email: "priya.n@example.com",
      };
      f.dispute = {
        reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
        network: "MASTERCARD",
        amount: "140.00",
        caseId: "EXAMPLE-NAD-2207",
        paymentId: "",
        respondBy: "",
        claim: "The cardholder says the colour is much lighter than the photos.",
        last4: "",
      };
      f.shipping = {
        carrier: "UPS",
        tracking: "1Z999AA10123456784",
        onPayPal: true,
        scans: ["10/07/2026 5:10 P.M.\tPickup Scan\tBrooklyn, NY, US", "10/09/2026 1:02 P.M.\tDELIVERED\tMontclair, NJ 07042"].join("\n"),
      };
      f.emails = [
        "14 Oct 2026, 09:05, Priya: The throw is much lighter than the photos, more denim than navy. I'd like a refund.",
        "14 Oct 2026, 13:40, Seller: Sorry it isn't what you hoped. The listing notes the shade varies batch to batch. We're happy to take it back: I can send you a prepaid return label today for a full refund.",
        "15 Oct 2026, 08:22, Priya: I don't want to deal with a return. I'm keeping it, but I've asked my bank for the money back.",
      ].join("\n");
      f.extra.listing =
        "Hand-dyed in small batches with natural indigo. Each throw is unique: the shade varies from deep navy to a lighter denim blue, and small streaks are part of the process. 130 × 170 cm, washed linen.";
      f.extra.policy = "Returns: we accept returns within 30 days of delivery for a full refund, with a prepaid return label.";
    }),
  },
];
