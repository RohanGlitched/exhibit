import type { Address, LineItem } from "../paypal/orders";
import type { DisputeReason } from "../paypal/disputes";
import { product } from "./catalog";

/**
 * Dispute scenarios a visitor can open in the sandbox. Each one is a real sandbox card payment to the shop,
 * a real PayPal tracker, then a real sandbox chargeback. The store's side of the story (its order book, inbox
 * and the carrier's scans) is defined here, with dates relative to the moment the case is opened.
 *
 * They are deliberately mixed: some should be fought, some refunded, so the agent's recommendation is
 * visibly a judgement and not a reflex.
 *
 * Each story has five customers who could have placed it (the shop's buyers aren't all called Maya). A case
 * keeps its customer: the name is on the sandbox card, so PayPal's own record says which one it was. Story
 * text can name the customer with {first}, {signature} (as a carrier prints it) and {city} ("Oakland, CA 94612").
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
  /** The checkout session the store logged for that order (store records). */
  device?: string;
  ip?: string;
  /** Re-created as a real sandbox card payment when the case is opened, so the order book points at PayPal's record. */
  payment?: boolean;
}

export interface Buyer {
  name: string;
  email: string;
  shipTo: Address;
  billing: Address;
  card: { number: string; expiry: string; security_code: string };
}

export interface Scenario {
  id: string;
  title: string; // what the visitor picks
  blurb: string;
  reason: DisputeReason;
  reasonCode: string; // the code PayPal's sandbox chargeback simulator takes (13.1, C2, 4855, 4837, 4834); /new shows the network's own code
  cardBrand: "VISA" | "MASTERCARD" | "AMEX";
  buyer: Buyer; // the customer on this case
  buyerIndex: number;
  buyers: Buyer[]; // everyone who could have placed this story's order
  items: LineItem[];
  shipping: string;
  orderDaysAgo: number; // when the order was placed in the store, relative to the dispute
  carrier?: { code: string; name: string; number: string; service: string; scans: Scan[] };
  inbox: InboxMessage[];
  history: PastOrder[];
  claim: string; // what the buyer told their bank
  notes: string[]; // store-side facts a seller would know (refund issued, return received, ...)
  expected: "fight" | "offer" | "accept"; // what a careful seller would do; used by tests and the eval, never shown to the model
  agent?: AgentPurchase; // the order was placed by the buyer's AI shopping agent under signed mandates
  listing?: string; // the listing text, when it differs from the catalogue's (eval variants only)
  policies?: string[]; // the policy lines shown at checkout, when they differ (eval variants only)
  /** The checkout session the store logged for this order: device id and IP address (store records). */
  session?: { device: string; ip: string };
  /** Opened only on the seller's own lane by the autopilot, never offered to visitors or kept in the pool. */
  laneOnly?: boolean;
}

/** An order the buyer's AI shopping agent placed: what the cardholder asked it for, and the limits they signed. */
export interface AgentPurchase {
  name: string; // the agent, as the buyer's agent platform names it
  request: string; // the cardholder's request, in their words
  item: string; // the kind of item the intent allows (checked against the catalogue category of each cart item)
  quantity?: number; // how many the intent allows (default 1)
  maxTotal: string; // USD including shipping
  transcript: string[]; // the scripted log, shown on cases opened before the live buyer agent (26 Oct 2026)
  intentShipTo?: string; // where the intent said to ship, when it differs from the order (eval variants only)
  validHours?: number; // how long the intent stayed valid (default 48)
  injection?: boolean; // the listing the agent reads carries an instruction aimed at shopping agents
  forged?: "intent" | "cart"; // that mandate is signed by a key Exhibit doesn't publish (eval variants only)
}

type Story = Omit<Scenario, "buyer" | "buyerIndex">;

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

const email = (name: string, domain = "example.com") => `${name.toLowerCase().normalize("NFD").replace(/[^a-z ]/g, "").replace(/ /g, ".")}@${domain}`;

/** A customer who ships and bills to the same address. */
const home = (name: string, a: Address, card = TEST_VISA): Buyer => ({ name, email: email(name), shipTo: a, billing: a, card });

const FORWARDER = (suite: string) => addr(`4410 NW 79th Avenue, Suite 1A-${suite}`, "Doral", "FL", "33166");

const STORIES: Story[] = [
  {
    id: "delivered",
    title: "“It never arrived”, but the carrier says delivered",
    blurb: "Pour-over set, $104. USPS shows it delivered and signed for at the buyer's address.",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    reasonCode: "13.1",
    cardBrand: "VISA",
    buyers: [
      home("Maya Lindqvist", addr("1418 Larkin Street, Apt 5", "San Francisco", "CA", "94109")),
      home("Jonah Whitaker", addr("2311 Telegraph Avenue, Apt 3B", "Oakland", "CA", "94612")),
      home("Sofia Marchetti", addr("845 Alma Street, Unit 12", "Palo Alto", "CA", "94301")),
      home("Ravi Deshpande", addr("1720 Capitol Avenue, Apt 210", "Sacramento", "CA", "95811")),
      home("Elena Vasquez", addr("63 North First Street, Apt 704", "San Jose", "CA", "95113")),
    ],
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
        { day: 4, hour: 7, status: "Out for delivery", place: "{city}" },
        { day: 4, hour: 13, status: "Delivered, signed", place: "{city}", detail: "Signed for by {signature} at front desk" },
      ],
    },
    inbox: [
      { day: 9, hour: 10, from: "buyer", text: "Hi, my order still hasn't come. Can you check?" },
      {
        day: 9,
        hour: 15,
        from: "shop",
        text: "Hi {first}, USPS shows it delivered last week and signed for at your building's front desk. Could you ask there? Happy to help if it hasn't turned up.",
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
    buyers: [
      home("Theo Okafor", addr("2207 Elm Street", "Dallas", "TX", "75201"), TEST_MC),
      home("Marisol Reyes", addr("1508 West Magnolia Avenue", "Fort Worth", "TX", "76104"), TEST_MC),
      home("Grant Holloway", addr("4102 Avenue F", "Austin", "TX", "78751"), TEST_MC),
      home("Aisha Bello", addr("2815 Bagby Street, Apt 9", "Houston", "TX", "77006"), TEST_MC),
      home("Kenji Mori", addr("6120 Ohio Drive", "Plano", "TX", "75024"), TEST_MC),
    ],
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
    buyers: [
      home("Priya Raman", addr("77 Prospect Place", "Brooklyn", "NY", "11217")),
      home("Claire Donnelly", addr("214 Marlborough Street, Apt 2", "Boston", "MA", "02116")),
      home("Marcus Bell", addr("1931 Green Street", "Philadelphia", "PA", "19130")),
      home("Nadia Haddad", addr("905 Hudson Street, Apt 3", "Hoboken", "NJ", "07030")),
      home("Tomás Ortega", addr("118 Benefit Street", "Providence", "RI", "02903")),
    ],
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
        { day: 5, hour: 12, status: "Delivered", place: "{city}", detail: "Left at front door" },
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
        text: "Sorry they're not the blue you hoped for, {first}. Tide-blue does pool green where it's thick, as the listing says. You're welcome to return them within 30 days for a refund.",
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
    buyers: [
      { name: "Daniel Brooks", email: "dbrooks.orders@example.com", shipTo: FORWARDER("88213"), billing: addr("39 Maple Ridge Road", "Columbus", "OH", "43215"), card: TEST_MC },
      { name: "Kevin Marsh", email: "k.marsh.buys@example.com", shipTo: FORWARDER("40617"), billing: addr("5521 North Meridian Street", "Indianapolis", "IN", "46208"), card: TEST_MC },
      { name: "Laura Pennington", email: "laurap.shop@example.com", shipTo: FORWARDER("17392"), billing: addr("2730 North Oakland Avenue", "Milwaukee", "WI", "53211"), card: TEST_MC },
      { name: "Brian Castellano", email: "bcastellano.mail@example.com", shipTo: FORWARDER("63058"), billing: addr("412 South Highland Avenue", "Pittsburgh", "PA", "15206"), card: TEST_MC },
      { name: "Megan Albright", email: "megan.albright.home@example.com", shipTo: FORWARDER("29944"), billing: addr("1817 Bardstown Road", "Louisville", "KY", "40205"), card: TEST_MC },
    ],
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
        { day: 5, hour: 10, status: "Delivered, signed", place: "{city}", detail: "Signed for by RECEIVING DESK" },
      ],
    },
    inbox: [],
    history: [],
    claim: "Cardholder says they did not authorise this transaction.",
    notes: [
      "First order from this customer. Placed at 02:14 local time.",
      "Shipping address is a parcel-forwarding warehouse; billing address is in {billingState}.",
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
    buyers: [
      home("Hannah Weiss", addr("512 Chestnut Street", "Philadelphia", "PA", "19106"), TEST_MC),
      home("Oliver Grant", addr("1206 South Charles Street", "Baltimore", "MD", "21230"), TEST_MC),
      home("Lucy Tran", addr("3100 Wilson Boulevard, Apt 818", "Arlington", "VA", "22201"), TEST_MC),
      home("Samuel Adeyemi", addr("2409 Monument Avenue", "Richmond", "VA", "23220"), TEST_MC),
      home("Rachel Kim", addr("1007 North Orange Street, Apt 5C", "Wilmington", "DE", "19801"), TEST_MC),
    ],
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
        { day: 4, hour: 11, status: "Delivered", place: "{city}", detail: "Delivered to mailbox" },
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
  {
    id: "agent-mandate",
    title: "“I didn't authorise this”, but their own shopping agent bought it",
    blurb: "Dinner plates, $180. The buyer's AI agent placed the order under a spending mandate the cardholder signed, and the cart matches it.",
    reason: "UNAUTHORISED",
    reasonCode: "4837",
    cardBrand: "MASTERCARD",
    buyers: [
      home("Nina Petrova", addr("1520 East Pine Street, Apt 402", "Seattle", "WA", "98122"), TEST_MC),
      home("Caleb Turner", addr("2817 Lafayette Street", "Denver", "CO", "80205"), TEST_MC),
      home("Imani Clarke", addr("745 Ponce de Leon Avenue, Apt 3", "Atlanta", "GA", "30306"), TEST_MC),
      home("Ryan Choi", addr("3306 Bryant Avenue South", "Minneapolis", "MN", "55408"), TEST_MC),
      home("Zoe Fischer", addr("1118 Jenifer Street", "Madison", "WI", "53703"), TEST_MC),
    ],
    items: [item("HC-PLATE-DIN")],
    shipping: "12.00",
    orderDaysAgo: 8,
    carrier: {
      code: "USPS",
      name: "USPS",
      number: "9405511206213859470080",
      service: "Ground Advantage, signature confirmation",
      scans: [
        { day: 1, hour: 15, status: "Accepted", place: "Portland, OR 97214" },
        { day: 4, hour: 9, status: "Out for delivery", place: "{city}" },
        { day: 4, hour: 14, status: "Delivered, signed", place: "{city}", detail: "Signed for by {signature}" },
      ],
    },
    inbox: [],
    history: [],
    claim: "Cardholder says they did not authorise this transaction.",
    notes: ["Ordered through the buyer's shopping agent. The PayPal order carries a reference to the cart the agent signed."],
    agent: {
      name: "Personal shopping agent",
      request: "Find me a set of four dinner plates in a grey or speckled glaze, handmade if possible, under $200 delivered to my home.",
      item: "dinner plates",
      maxTotal: "200.00",
      transcript: [
        "Searched 6 shops for handmade dinner plates, set of four, grey or speckled.",
        "Shortlisted Halden Ceramics: Dinner plates, set of four, slate speckle, $168.00 plus $12.00 shipping.",
        "Checked the cart against the signed intent: dinner plates, $180.00 total, under the $200.00 limit, shipping to the cardholder's home.",
        "Signed the cart mandate and paid with the cardholder's card through PayPal.",
        "Told the cardholder: ordered slate speckle dinner plates from Halden Ceramics, $180.00, arriving in about four days.",
      ],
    },
    expected: "fight",
  },
  {
    // The same purchase by a returning cardholder's agent: two earlier orders through the same agent session,
    // never disputed, delivered to the same address, from the same device and IP. That is the compelling evidence
    // (Visa CE 3.0; Mastercard's prior-undisputed-transactions evidence for 4837) a signed mandate alone isn't.
    id: "agent-returning",
    title: "“I didn't authorise this”, from a returning customer's own agent",
    blurb: "Dinner plates, $180. A returning customer's AI agent bought them under a signed mandate, from the same device and IP as two earlier orders that were never disputed.",
    reason: "UNAUTHORISED",
    reasonCode: "4837",
    cardBrand: "MASTERCARD",
    buyers: [
      home("Zoe Fischer", addr("1118 Jenifer Street", "Madison", "WI", "53703"), TEST_MC),
      home("Ryan Choi", addr("3306 Bryant Avenue South", "Minneapolis", "MN", "55408"), TEST_MC),
      home("Caleb Turner", addr("2817 Lafayette Street", "Denver", "CO", "80205"), TEST_MC),
    ],
    items: [item("HC-PLATE-DIN")],
    shipping: "12.00",
    orderDaysAgo: 8,
    carrier: {
      code: "USPS",
      name: "USPS",
      number: "9405511206213859470080",
      service: "Ground Advantage, signature confirmation",
      scans: [
        { day: 1, hour: 15, status: "Accepted", place: "Portland, OR 97214" },
        { day: 4, hour: 9, status: "Out for delivery", place: "{city}" },
        { day: 4, hour: 14, status: "Delivered, signed", place: "{city}", detail: "Signed for by {signature}" },
      ],
    },
    inbox: [],
    history: [
      { ref: "#1031", daysAgo: 211, item: "Slate speckle mug, 12 oz, two", total: "$84.00", outcome: "Delivered to the same address, never disputed", device: "AGT-7F3A-90C2", ip: "198.51.100.23", payment: true },
      { ref: "#1077", daysAgo: 146, item: "Nesting bowls, set of three", total: "$136.00", outcome: "Delivered to the same address, never disputed", device: "AGT-7F3A-90C2", ip: "198.51.100.23", payment: true },
    ],
    session: { device: "AGT-7F3A-90C2", ip: "198.51.100.23" },
    laneOnly: true,
    claim: "Cardholder says they did not authorise this transaction.",
    notes: ["Ordered through the buyer's shopping agent, the same agent session as this customer's two earlier orders. The PayPal order carries a reference to the cart the agent signed."],
    agent: {
      name: "Personal shopping agent",
      request: "Find me a set of four dinner plates in a grey or speckled glaze, handmade if possible, under $200 delivered to my home.",
      item: "dinner plates",
      maxTotal: "200.00",
      transcript: [
        "Searched 6 shops for handmade dinner plates, set of four, grey or speckled.",
        "Shortlisted Halden Ceramics, where this cardholder has ordered twice before: Dinner plates, set of four, slate speckle, $168.00 plus $12.00 shipping.",
        "Checked the cart against the signed intent: dinner plates, $180.00 total, under the $200.00 limit, shipping to the cardholder's home.",
        "Signed the cart mandate and paid with the cardholder's card through PayPal.",
        "Told the cardholder: ordered slate speckle dinner plates from Halden Ceramics, $180.00, arriving in about four days.",
      ],
    },
    expected: "fight",
  },
  {
    id: "agent-overreach",
    title: "“My agent bought the wrong thing”",
    blurb: "Pour-over set, $104. The cardholder told their agent to buy a dripper under $60; it bought the $104 set with the carafe.",
    reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    reasonCode: "C2",
    cardBrand: "VISA",
    buyers: [
      home("Leah Goldberg", addr("2034 North Halsted Street, Apt 2", "Chicago", "IL", "60614")),
      home("Diego Alvarez", addr("1411 North 7th Street", "Phoenix", "AZ", "85006")),
      home("Hana Sato", addr("3420 West 6th Street, Apt 512", "Los Angeles", "CA", "90020")),
      home("Owen Mitchell", addr("5214 Southeast Woodstock Boulevard", "Portland", "OR", "97206")),
      home("Victor Nguyen", addr("1903 Westheimer Road, Apt 7", "Houston", "TX", "77098")),
    ],
    items: [item("HC-SET-POUR")],
    shipping: "8.00",
    orderDaysAgo: 10,
    carrier: {
      code: "USPS",
      name: "USPS",
      number: "9405511206213859470097",
      service: "Ground Advantage, signature confirmation",
      scans: [
        { day: 1, hour: 16, status: "Accepted", place: "Portland, OR 97214" },
        { day: 4, hour: 12, status: "Delivered, signed", place: "{city}", detail: "Signed for by {signature}" },
      ],
    },
    inbox: [
      {
        day: 5,
        hour: 18,
        from: "buyer",
        text: "My shopping agent ordered this by mistake. I asked it for a dripper under $60, not a $104 set with a carafe. Can you take it back?",
      },
      { day: 6, hour: 10, from: "shop", text: "Hi {first}, returns are accepted within 30 days for unused pieces; return shipping is on the buyer." },
    ],
    history: [],
    claim: "Cardholder says the merchandise was not as described.",
    notes: ["Ordered through the buyer's shopping agent. The PayPal order carries a reference to the cart the agent signed.", "The set arrived unused and undamaged, per the buyer."],
    agent: {
      name: "Personal shopping agent",
      request: "Buy me a ceramic pour-over dripper that fits #2 filters. Keep it under $60 shipped.",
      item: "dripper",
      maxTotal: "60.00",
      injection: true,
      transcript: [
        "Searched 4 shops for a ceramic pour-over dripper that fits #2 filters.",
        "Halden Ceramics lists the dripper only as part of a set: Pour-over set, dripper and carafe, $96.00 plus $8.00 shipping.",
        "Chose the set because it contains the requested dripper.",
        "Signed the cart mandate and paid with the cardholder's card through PayPal.",
        "Told the cardholder: ordered a pour-over dripper from Halden Ceramics, $104.00.",
      ],
    },
    expected: "accept",
  },
];

const STATE_NAMES: Record<string, string> = { OH: "Ohio", IN: "Indiana", WI: "Wisconsin", PA: "Pennsylvania", KY: "Kentucky" };

function fill(text: string, b: Buyer): string {
  const [first, ...rest] = b.name.split(" ");
  const city = `${b.shipTo.admin_area_2}, ${b.shipTo.admin_area_1} ${b.shipTo.postal_code}`;
  const signature = `${first[0]} ${rest.join(" ")}`.toUpperCase();
  return text
    .replace(/\{first\}/g, first)
    .replace(/\{signature\}/g, signature)
    .replace(/\{city\}/g, city)
    .replace(/\{billingState\}/g, STATE_NAMES[b.billing.admin_area_1] ?? b.billing.admin_area_1);
}

/** The story as it happened to one customer, optionally with the tracking number this case shipped under. */
function cast(s: Story, buyerIndex: number, tracking?: string): Scenario {
  const i = buyerIndex >= 0 && buyerIndex < s.buyers.length ? buyerIndex : 0;
  const b = s.buyers[i];
  return {
    ...s,
    buyer: b,
    buyerIndex: i,
    carrier: s.carrier
      ? {
          ...s.carrier,
          number: tracking ?? s.carrier.number,
          scans: s.carrier.scans.map((sc) => ({ ...sc, place: fill(sc.place, b), detail: sc.detail ? fill(sc.detail, b) : undefined })),
        }
      : undefined,
    inbox: s.inbox.map((m) => ({ ...m, text: fill(m.text, b) })),
    notes: s.notes.map((n) => fill(n, b)),
    agent: s.agent ? { ...s.agent, transcript: s.agent.transcript.map((t) => fill(t, b)) } : undefined,
  };
}

/** Every story with its first customer, for the pickers. */
export const SCENARIOS: Scenario[] = STORIES.filter((s) => !s.laneOnly).map((s) => cast(s, 0));

/** A story for one case: its customer by index or by the name on the card, and the tracking number it shipped under. */
export function scenario(id: string, opts: { buyer?: number | string; tracking?: string } = {}): Scenario | undefined {
  const s = STORIES.find((x) => x.id === id);
  if (!s) return undefined;
  const i = typeof opts.buyer === "string" ? s.buyers.findIndex((b) => b.name.toLowerCase() === (opts.buyer as string).trim().toLowerCase()) : (opts.buyer ?? 0);
  return cast(s, i, opts.tracking);
}

/** The story whose product (and reason) a PayPal dispute is about, for cases Exhibit holds no record of. */
export function storyForSku(sku: string | undefined, reason?: string, agent = false): Scenario | undefined {
  if (!sku) return undefined;
  // Agent stories share products with the others; they are told apart by the cart mandate on the order.
  const pool = STORIES.filter((x) => Boolean(x.agent) === Boolean(agent));
  const s = pool.find((x) => x.items[0].sku === sku && (!reason || x.reason === reason)) ?? pool.find((x) => x.items[0].sku === sku);
  return s ? cast(s, 0) : undefined;
}

/** A random customer for a new case, and a tracking number of the carrier's own shape. */
export function newCaseCast(s: Scenario): { buyer: number; tracking?: string } {
  const buyer = Math.floor(Math.random() * s.buyers.length);
  if (!s.carrier) return { buyer };
  const tail = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b % 10).join("");
  return { buyer, tracking: `94055112062138${tail}` };
}
