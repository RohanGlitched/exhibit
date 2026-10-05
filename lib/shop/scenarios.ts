import type { Address, LineItem } from "../paypal/orders";
import type { DisputeReason } from "../paypal/disputes";
import { product } from "./catalog";

/**
 * Dispute scenarios a visitor can open in the sandbox. Each one is a real sandbox card payment to the shop,
 * a real PayPal tracker, then a real sandbox chargeback. The store's side of the story (its order book, inbox
 * and the carrier's scans) is defined here, with dates relative to the moment the case is opened.
 *
 * They are deliberately mixed: some should be fought, some refunded, one partly refunded, so the agent's
 * recommendation is visibly a judgement and not a reflex.
 */

export interface Scan {
  day: number; // days after the order (negative = before the dispute was opened)
  hour: number;
  status: "Label created" | "Accepted" | "In transit" | "Out for delivery" | "Delivered" | "Delivered, signed" | "Attempted";
  place: string;
  detail?: string;
}

export interface InboxMessage {
  day: number;
  hour: number;
  from: "buyer" | "shop";
  text: string;
}

export interface PastOrder {
  ref: string;
  daysAgo: number;
  item: string;
  total: string;
  outcome: string;
}

export interface Scenario {
  id: string;
  title: string; // what the visitor picks
  blurb: string;
  reason: DisputeReason;
  reasonCode: string; // card-network reason code for the sandbox chargeback (Visa 13.1/C2, Mastercard 4855/4837/4834 map to these reasons)
  cardBrand: "VISA" | "MASTERCARD" | "AMEX";
  buyer: {
    name: string;
    email: string;
    shipTo: Address;
    billing: Address;
    card: { number: string; expiry: string; security_code: string };
  };
  items: LineItem[];
  shipping: string;
  orderDaysAgo: number; // when the order was placed in the store, relative to the dispute
  carrier?: { code: string; name: string; number: string; service: string; scans: Scan[] };
  inbox: InboxMessage[];
  history: PastOrder[];
  claim: string; // what the buyer told their bank
  notes: string[]; // store-side facts a seller would know (refund issued, return received, ...)
  expected: "fight" | "offer" | "accept"; // what a careful seller would do; used by tests, never shown to the model
}

const item = (sku: string, quantity = 1): LineItem => {
  const p = product(sku);
  return { name: p.name, sku: p.sku, price: p.price, quantity, description: p.listing };
};

const TEST_VISA = { number: "4012888888881881", expiry: "2030-12", security_code: "123" };
const TEST_MC = { number: "2223000048400011", expiry: "2029-08", security_code: "321" };

const addr = (address_line_1: string, admin_area_2: string, admin_area_1: string, postal_code: string): Address => ({
  address_line_1,
  admin_area_2,
  admin_area_1,
  postal_code,
  country_code: "US",
});

export const SCENARIOS: Scenario[] = [
  {
    id: "delivered",
    title: "“It never arrived”, but the carrier says delivered",
    blurb: "Pour-over set, $104. USPS shows it delivered and signed for at the buyer's address.",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    reasonCode: "13.1",
    cardBrand: "VISA",
    buyer: {
      name: "Maya Lindqvist",
      email: "maya.lindqvist@example.com",
      shipTo: addr("1418 Larkin Street, Apt 5", "San Francisco", "CA", "94109"),
      billing: addr("1418 Larkin Street, Apt 5", "San Francisco", "CA", "94109"),
      card: TEST_VISA,
    },
    items: [item("HC-SET-POUR")],
    shipping: "8.00",
    orderDaysAgo: 12,
    carrier: {
      code: "USPS",
      name: "USPS",
      number: "9405511206213859470035",
      service: "Ground Advantage, signature confirmation",
      scans: [
        { day: 1, hour: 16, status: "Label created", place: "Portland, OR 97214" },
        { day: 1, hour: 18, status: "Accepted", place: "Portland, OR 97214" },
        { day: 2, hour: 23, status: "In transit", place: "Sacramento, CA network distribution center" },
        { day: 4, hour: 7, status: "Out for delivery", place: "San Francisco, CA 94109" },
        { day: 4, hour: 13, status: "Delivered, signed", place: "San Francisco, CA 94109", detail: "Signed for by M LINDQVIST at front desk" },
      ],
    },
    inbox: [
      { day: 9, hour: 10, from: "buyer", text: "Hi, my order still hasn't come. Can you check?" },
      {
        day: 9,
        hour: 15,
        from: "shop",
        text: "Hi Maya, USPS shows it delivered last week and signed for at your building's front desk. Could you ask there? Happy to help if it hasn't turned up.",
      },
    ],
    history: [{ ref: "#1019", daysAgo: 140, item: "Slate speckle mug, 12 oz", total: "$46.00", outcome: "Delivered, no issues" }],
    claim: "Cardholder says the merchandise was not received.",
    notes: [],
    expected: "fight",
  },
  {
    id: "untracked",
    title: "Small order that shipped without tracking",
    blurb: "Bud vase, $27. First-Class mail, no tracking number, buyer says it never came.",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    reasonCode: "4855",
    cardBrand: "MASTERCARD",
    buyer: {
      name: "Theo Okafor",
      email: "theo.okafor@example.com",
      shipTo: addr("2207 Elm Street", "Dallas", "TX", "75201"),
      billing: addr("2207 Elm Street", "Dallas", "TX", "75201"),
      card: TEST_MC,
    },
    items: [item("HC-VASE-TALL")],
    shipping: "5.00",
    orderDaysAgo: 24,
    inbox: [
      { day: 18, hour: 9, from: "buyer", text: "Still no vase after almost three weeks. Was it sent?" },
      { day: 20, hour: 12, from: "buyer", text: "Following up again. I'd like a refund if it's lost." },
    ],
    history: [],
    claim: "Cardholder says the merchandise was not received.",
    notes: ["Shipped First-Class without tracking (under the $40 tracking threshold).", "The buyer's two emails were not answered."],
    expected: "accept",
  },
  {
    id: "colour",
    title: "“Not as described”: the glaze colour",
    blurb: "Nesting bowls, $136. The blue came out greener than the photos, and the listing warned it might.",
    reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    reasonCode: "C2",
    cardBrand: "VISA",
    buyer: {
      name: "Priya Raman",
      email: "priya.raman@example.com",
      shipTo: addr("77 Prospect Place", "Brooklyn", "NY", "11217"),
      billing: addr("77 Prospect Place", "Brooklyn", "NY", "11217"),
      card: TEST_VISA,
    },
    items: [item("HC-BOWL-NEST")],
    shipping: "12.00",
    orderDaysAgo: 15,
    carrier: {
      code: "USPS",
      name: "USPS",
      number: "9405511206213859470042",
      service: "Ground Advantage",
      scans: [
        { day: 1, hour: 15, status: "Accepted", place: "Portland, OR 97214" },
        { day: 3, hour: 4, status: "In transit", place: "Chicago, IL network distribution center" },
        { day: 5, hour: 12, status: "Delivered", place: "Brooklyn, NY 11217", detail: "Left at front door" },
      ],
    },
    inbox: [
      {
        day: 6,
        hour: 19,
        from: "buyer",
        text: "The bowls arrived safely but they're much greener than the photos. I bought them to match my blue dishes. Not what I expected.",
      },
      {
        day: 7,
        hour: 11,
        from: "shop",
        text: "Sorry they're not the blue you hoped for. Tide-blue does pool green where it's thick, as the listing says. You're welcome to return them within 30 days for a refund.",
      },
      { day: 8, hour: 8, from: "buyer", text: "Return shipping for three bowls would be about $30. That doesn't seem fair." },
    ],
    history: [],
    claim: "Cardholder says the merchandise was not as described.",
    notes: ["Listing text says colour shifts from deep blue to green where the glaze pools.", "No breakage reported."],
    expected: "fight",
  },
  {
    id: "fraud",
    title: "“I didn't make this purchase”",
    blurb: "Dinner plates, $180. New customer, billing and shipping addresses differ, shipped to a parcel forwarder.",
    reason: "UNAUTHORISED",
    reasonCode: "4837",
    cardBrand: "MASTERCARD",
    buyer: {
      name: "Daniel Brooks",
      email: "dbrooks.orders@example.com",
      shipTo: addr("4410 NW 79th Avenue, Suite 1A-88213", "Doral", "FL", "33166"),
      billing: addr("39 Maple Ridge Road", "Columbus", "OH", "43215"),
      card: TEST_MC,
    },
    items: [item("HC-PLATE-DIN")],
    shipping: "12.00",
    orderDaysAgo: 9,
    carrier: {
      code: "USPS",
      name: "USPS",
      number: "9405511206213859470059",
      service: "Ground Advantage, signature confirmation",
      scans: [
        { day: 0, hour: 22, status: "Label created", place: "Portland, OR 97214" },
        { day: 1, hour: 17, status: "Accepted", place: "Portland, OR 97214" },
        { day: 5, hour: 10, status: "Delivered, signed", place: "Doral, FL 33166", detail: "Signed for by RECEIVING DESK" },
      ],
    },
    inbox: [],
    history: [],
    claim: "Cardholder says they did not authorise this transaction.",
    notes: [
      "First order from this customer. Placed at 02:14 local time.",
      "Shipping address is a parcel-forwarding warehouse; billing address is in Ohio.",
    ],
    expected: "accept",
  },
  {
    id: "duplicate",
    title: "“Charged twice”, already refunded",
    blurb: "Slate mug, $46. The buyer double-clicked checkout; the second charge was refunded the next day.",
    reason: "DUPLICATE_TRANSACTION",
    reasonCode: "4834",
    cardBrand: "MASTERCARD",
    buyer: {
      name: "Hannah Weiss",
      email: "hannah.weiss@example.com",
      shipTo: addr("512 Chestnut Street", "Philadelphia", "PA", "19106"),
      billing: addr("512 Chestnut Street", "Philadelphia", "PA", "19106"),
      card: TEST_MC,
    },
    items: [item("HC-MUG-SLATE")],
    shipping: "8.00",
    orderDaysAgo: 11,
    carrier: {
      code: "USPS",
      name: "USPS",
      number: "9405511206213859470066",
      service: "Ground Advantage",
      scans: [
        { day: 1, hour: 14, status: "Accepted", place: "Portland, OR 97214" },
        { day: 4, hour: 11, status: "Delivered", place: "Philadelphia, PA 19106", detail: "Delivered to mailbox" },
      ],
    },
    inbox: [
      { day: 0, hour: 21, from: "buyer", text: "I think I got charged twice for the mug, the page froze." },
      { day: 1, hour: 9, from: "shop", text: "You're right, two charges went through. I've refunded the second one today; it takes 3-5 days to show." },
    ],
    history: [],
    claim: "Cardholder says they were charged twice for one purchase.",
    notes: ["The checkout page froze and took the payment twice. The second charge, $46.00, was refunded in full the next day."],
    expected: "fight",
  },
];

export const scenario = (id: string) => SCENARIOS.find((s) => s.id === id);
