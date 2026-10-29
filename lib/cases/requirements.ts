import type { Exhibit } from "./types";

/**
 * What the card network asks a seller to show for this reason code, and whether the case's own exhibits hold
 * it: each item on file, weak or missing, with the exhibits behind it. Read by code from the exhibits, never by
 * the model, so the drafter, the reviewer and the case page all see the same card.
 *
 * The items summarise the networks' public dispute rules as they bear on a small online shop: Visa 13.1
 * (merchandise not received), 13.3 (not as described), 10.4 (card-absent fraud, with Compelling Evidence 3.0),
 * 12.6.1 (duplicate); Mastercard 4853 (cardholder dispute: not received or not as described), 4837 (no
 * cardholder authorisation), 4834 (duplicate). PayPal's own Seller Protection proof of delivery is folded into
 * the delivery items. Safe to import from client components.
 */

export type Status = "on file" | "weak" | "missing";

export interface Requirement {
  id: string;
  need: string; // what the network asks for, in plain words
  status: Status;
  detail: string; // what the exhibits hold, or don't
  exhibits: string[]; // letters of the exhibits behind it
  required: boolean; // the response fails without it; otherwise it strengthens the case
  ask: string; // the reviewer's question when the item is weak or missing
}

export interface RequirementsCard {
  network: "Visa" | "Mastercard" | "Amex" | "PayPal";
  code: string;
  title: string;
  items: Requirement[];
  /** Every required item on file: met; one missing: not met; otherwise partly. */
  standing: "met" | "partly" | "not met";
  note?: string;
}

/** The network's own code for a case: PayPal's sandbox takes C2 for Visa 13.3 and the retired 4855 for Mastercard 4853. */
const SANDBOX_CODE: Record<string, string> = { C2: "13.3", "4855": "4853" };
const BY_REASON: Record<string, Record<string, string>> = {
  VISA: { MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "13.1", MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "13.3", UNAUTHORISED: "10.4", DUPLICATE_TRANSACTION: "12.6.1" },
  MASTERCARD: { MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "4853", MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "4853", UNAUTHORISED: "4837", DUPLICATE_TRANSACTION: "4834" },
};
const TITLES: Record<string, string> = {
  "13.1": "Merchandise not received",
  "13.3": "Not as described",
  "10.4": "Fraud, card absent",
  "12.6.1": "Duplicate processing",
  "4853": "Cardholder dispute",
  "4837": "No cardholder authorisation",
  "4834": "Duplicate transaction",
};

const fact = (e: Exhibit | undefined, label: string) => e?.facts.find((f) => f.label === label)?.value;
const zipOf = (s?: string) => s?.match(/\b\d{5}\b(?!.*\b\d{5}\b)/)?.[0];
const letters = (...es: (Exhibit | undefined)[]) => [...new Set(es.filter((e): e is Exhibit => !!e).map((e) => e.id))];

/** The card brand on the order ("Paid with: VISA ending 4242"), when there is a card. */
export function brandOf(exhibits: Exhibit[]): string | null {
  const paid = fact(exhibits.find((e) => e.kind === "order"), "Paid with") ?? "";
  const m = paid.match(/^(VISA|MASTERCARD|AMEX|AMERICAN EXPRESS)\b/i);
  return m ? (m[1].toUpperCase().startsWith("AM") ? "AMEX" : m[1].toUpperCase()) : null;
}

export function networkCode(reason: string, brand: string | null, sandboxCode?: string | null): { network: RequirementsCard["network"]; code: string } {
  const network = brand === "VISA" ? "Visa" : brand === "MASTERCARD" ? "Mastercard" : brand === "AMEX" ? "Amex" : "PayPal";
  const given = sandboxCode ? (SANDBOX_CODE[sandboxCode] ?? sandboxCode) : null;
  const code = given ?? (brand ? BY_REASON[brand]?.[reason] : undefined) ?? (network === "PayPal" ? "Seller Protection" : reason.toLowerCase().replace(/_/g, " "));
  return { network, code };
}

function item(id: string, need: string, status: Status, detail: string, exhibits: string[], required: boolean, ask: string): Requirement {
  return { id, need, status, detail, exhibits, required, ask };
}

/* ───────────── Delivery: tracking, a delivered scan, at the transaction's address ───────────── */

function delivery(exhibits: Exhibit[], amount: number): Requirement[] {
  const by = (k: Exhibit["kind"]) => exhibits.find((e) => e.kind === k);
  const order = by("order");
  const tracking = by("tracking");
  const scans = by("scans");
  const carrier = fact(tracking, "Carrier");
  const number = fact(tracking, "Tracking number");
  const delivered = scans?.lines?.find((l) => /\bDelivered\b/.test(l) && !/to sender/i.test(l));
  const returned = scans?.lines?.some((l) => /to sender|return to sender/i.test(l));
  const shipZip = zipOf(fact(order, "Ship to"));
  const deliveredZip = zipOf(delivered);
  const date = delivered?.match(/^\d{1,2} \w{3} \d{4}/)?.[0];
  const signed = delivered && /\bsigned\b/i.test(delivered);
  const out: Requirement[] = [];
  out.push(
    tracking && carrier && carrier !== "—" && number
      ? item("tracking", "Carrier and tracking number", "on file", `${carrier} ${number}, on file with PayPal`, letters(tracking), true, "")
      : scans
        ? item("tracking", "Carrier and tracking number", "weak", "Carrier scans, but no tracker on file with PayPal", letters(scans), true, "Where is the tracking number on file with PayPal for this parcel?")
        : item("tracking", "Carrier and tracking number", "missing", "No tracking on file", [], true, "What tracking shows this parcel was shipped at all?"),
  );
  out.push(
    delivered && date
      ? item("delivered", "A delivered scan with its date", "on file", `Delivered ${date}`, letters(scans), true, "")
      : item("delivered", "A delivered scan with its date", "missing", returned ? "The only delivered scan is back at the sender" : scans ? "No delivered scan" : "No carrier scans", letters(scans), true, "What carrier record shows the parcel delivered, and on what date?"),
  );
  out.push(
    delivered && shipZip && deliveredZip === shipZip
      ? item("address", "Delivered to the address on the transaction", "on file", `Delivered in ${deliveredZip}, the order's ship-to ZIP`, letters(scans, order), true, "")
      : delivered && shipZip && deliveredZip
        ? item("address", "Delivered to the address on the transaction", "missing", `Delivered in ${deliveredZip}; the order ships to ${shipZip}`, letters(scans, order), true, `The delivery scan is in ${deliveredZip} and the order ships to ${shipZip}: how was it delivered to the buyer's address?`)
        : item("address", "Delivered to the address on the transaction", delivered ? "weak" : "missing", delivered ? "The scan's ZIP can't be matched to the ship-to" : "Nothing shows where it was delivered", letters(scans, order), true, "Which page ties the delivery to the address on the order?"),
  );
  // PayPal's Seller Protection asks for signed proof only over $750; it is strong evidence at any amount.
  out.push(
    signed
      ? item("signature", amount > 750 ? "Signed proof of delivery (over $750)" : "Signed proof of delivery", "on file", delivered!.match(/Signed for by [^.]+/)?.[0] ?? "Signed for", letters(scans), amount > 750, "")
      : item(
          "signature",
          amount > 750 ? "Signed proof of delivery (over $750)" : "Signed proof of delivery",
          "missing",
          amount > 750 ? "No signature, and the amount is over $750" : "No signature; not required under $750",
          letters(scans),
          amount > 750,
          "Who signed for this parcel?",
        ),
  );
  return out;
}

/* ───────────── Not as described: the listing, a disclosure, a return ───────────── */

const ADMITS = /\b(?:I|we) (?:do )?recogni[sz]e\b|\brealised it was my order\b|\brealized it was my order\b|\bit was my (?:order|purchase)\b|\bI'?m keeping (?:it|them)\b|\bI (?:have|got|received) (?:the|them|it|my)\b|\bI (?:did )?(?:make|made|placed?) (?:this|the|that) (?:order|purchase)\b|\b(?:cancel|drop) the (?:dispute|chargeback)\b/i;
const OFFERS_RETURN =
  /\breturns? (?:are|is) accepted\b|\bwe (?:can|will|would) (?:take|accept) (?:it|them|the \w+) back\b|\bsend (?:it|them) back\b|\breturn label\b|\bhappy to (?:take|accept) (?:it|them) back\b|\boffer(?:ed)? (?:a |you a )?return\b/i;
const DISCLOSES = /\bvar(?:y|ies|iation)\b|\bdiffer|\beach piece\b|\bno two\b|\bshifts?\b|\bmay (?:look|appear|show|differ)\b|\bunique\b/i;

function described(exhibits: Exhibit[]): Requirement[] {
  const by = (k: Exhibit["kind"]) => exhibits.find((e) => e.kind === k);
  const listing = by("listing");
  const policy = by("policy");
  const inbox = by("inbox");
  const text = (e?: Exhibit) => [...(e?.facts ?? []).map((f) => f.value), ...(e?.lines ?? [])].join(" ");
  const disclosed = DISCLOSES.test(text(listing)) ? listing : DISCLOSES.test(text(policy)) ? policy : undefined;
  const returnLine = /\breturns?\b/i.test(text(policy)) ? policy : undefined;
  const offered = inbox?.lines?.find((l) => OFFERS_RETURN.test(l));
  return [
    listing
      ? item("listing", "The item as it was described when sold", "on file", `The listing for ${listing.title.replace(/^Listing: /, "")}`, letters(listing), true, "")
      : item("listing", "The item as it was described when sold", "missing", "No listing on file", [], true, "What did the listing say the buyer was buying?"),
    disclosed
      ? item("disclosure", "A disclosure of what the buyer complains about", "weak", `${disclosed.kind === "listing" ? "The listing" : "The policy"} discloses variation; whether it covers this complaint is a reading of the words`, letters(disclosed), true, "Where do the pages disclose the specific difference the buyer complains about?")
      : item("disclosure", "A disclosure of what the buyer complains about", "missing", "Nothing on file discloses a difference", letters(listing), true, "Where did the listing warn the buyer about the difference they complain about?"),
    returnLine
      ? item("return", "A return offered under the policy shown at checkout", offered ? "on file" : "weak", offered ? "The policy, and the seller offered a return by email" : "The policy offers returns; no email offering one", letters(policy, offered ? inbox : undefined), false, "Did the seller offer this buyer a return?")
      : item("return", "A return offered under the policy shown at checkout", "missing", "No return policy on file", [], false, "Was a return ever offered?"),
  ];
}

/* ───────────── Fraud: what ties the cardholder to the order ───────────── */

function fraud(exhibits: Exhibit[], visa: boolean): Requirement[] {
  const by = (k: Exhibit["kind"]) => exhibits.find((e) => e.kind === k);
  const payment = by("payment");
  const history = by("history");
  const notes = by("note");
  const scans = by("scans");
  const order = by("order");
  const check = by("check");
  const avs = fact(payment, "Address check") ?? "";
  const cvv = fact(payment, "Security code") ?? "";
  const billing = fact(payment, "Billing address");
  const prior = (history?.lines ?? []).filter((l) => !/^First order/.test(l) && /no issues|delivered/i.test(l) && !/disput|chargeback/i.test(l));
  const device = (notes?.lines ?? []).find((l) => /\bdevice\b|\bIP\b|\bbrowser\b/i.test(l));
  const delivered = scans?.lines?.find((l) => /\bDelivered\b/.test(l) && !/to sender/i.test(l));
  const home = delivered && zipOf(delivered) === zipOf(fact(order, "Ship to")) && !billing;
  const out: Requirement[] = [];

  const avsOk = /^[YX]\b/.test(avs);
  const cvvOk = /^M\b/.test(cvv);
  out.push(
    item(
      "avs-cvv",
      "Address and security-code checks",
      avsOk && cvvOk ? "weak" : "missing",
      avsOk && cvvOk ? "Both matched; they show the card details were known, not that the cardholder took part" : `Address ${avs || "not checked"}; security code ${cvv || "not checked"}`,
      letters(payment),
      false,
      "Matching address and security-code checks show someone had the card details. What shows the cardholder took part?",
    ),
  );
  out.push(
    item(
      "3ds",
      "3-D Secure authentication (liability shift)",
      "missing",
      "None on file: no 3-D Secure result, so no liability shift to the issuer",
      [],
      false,
      "No 3-D Secure result is on file, so liability did not shift. What else proves the cardholder authorised it?",
    ),
  );
  out.push(
    prior.length >= 2
      ? item("prior", `${visa ? "Compelling Evidence 3.0" : "Compelling-evidence"}: two earlier undisputed orders`, "weak",`${prior.length} earlier orders delivered without dispute; CE 3.0 also needs them to share the IP or device with this one`, letters(history), true, "Do the earlier orders share an IP address or device id with this one, as compelling evidence requires?")
      : prior.length === 1
        ? item("prior", `${visa ? "Compelling Evidence 3.0" : "Compelling-evidence"}: two earlier undisputed orders`, "weak", "One earlier order; the standard asks for two", letters(history), true, "One earlier order isn't two. What else ties the cardholder to this order?")
        : item("prior", `${visa ? "Compelling Evidence 3.0" : "Compelling-evidence"}: two earlier undisputed orders`, "missing", "No earlier orders from this customer", letters(history), true, "This is the customer's first order. What ties the cardholder to it?"),
  );
  out.push(
    device
      ? item("device", "A matching IP address or device id", "weak", "The seller's note names the same device, but no IP or device id is on file", letters(notes), true, "What device id or IP address shows this was the same device?")
      : item("device", "A matching IP address or device id", "missing", "No IP address or device id on file", [], true, "What IP address or device id ties this order to the cardholder?"),
  );
  out.push(
    billing
      ? item("ship-billing", "Shipped to the cardholder's billing address", "missing", "Shipped somewhere other than the billing address", letters(payment, order), false, "The parcel shipped away from the billing address. Why does that point to the cardholder?")
      : home && /\bsigned\b/i.test(delivered!)
        ? item("ship-billing", "Shipped to the cardholder's billing address", "on file", "Delivered and signed for at the order's address, which is the billing address", letters(scans, order), false, "")
        : item("ship-billing", "Shipped to the cardholder's billing address", home ? "weak" : "missing", home ? "Delivered at the order's address, unsigned" : "No delivery to the cardholder's address on file", letters(scans, order), false, "Who received the parcel at the cardholder's address?"),
  );
  // The cardholder's own words that they made the purchase or have the goods: read from the inbox by pattern.
  const inbox = exhibits.find((e) => e.kind === "inbox");
  const admits = inbox?.lines?.find((l) => ADMITS.test(l));
  if (admits)
    out.push(item("admission", "The cardholder acknowledging the purchase in writing", "weak", "An email in the cardholder's name says they recognise the order or have it; read by pattern, so read it yourself", letters(inbox), false, "Does the cardholder's email admit this purchase, and is it from the cardholder's own address?"));
  if (check) {
    const party = fact(check, "Responsible");
    const withdrawn = (check.lines ?? []).some((l) => /withdrew consent/.test(l));
    out.push(
      party === "Cardholder"
        ? item(
            "mandate",
            "The cardholder's signed instruction to their agent (AP2 mandate)",
            "weak",
            "Signed intent covers the cart and verifies; card networks don't yet recognise a mandate as authorisation evidence, so it needs the items above",
            letters(check, ...exhibits.filter((e) => e.kind === "mandate")),
            false,
            "A signed mandate isn't authorisation evidence the networks recognise. What network-recognised evidence ties the cardholder to this order?",
          )
        : item("mandate", "The cardholder's signed instruction to their agent (AP2 mandate)", "missing", withdrawn ? "The cardholder withdrew consent before checkout" : "The mandate check doesn't hold the cardholder responsible", letters(check), false, "The mandate check doesn't hold the cardholder responsible. How is this order authorised?"),
    );
  }
  return out;
}

/* ───────────── Duplicate: a credit on the duplicate, or two distinct transactions ───────────── */

function duplicate(exhibits: Exhibit[]): Requirement[] {
  const refund = exhibits.find((e) => e.kind === "refund");
  const payments = exhibits.filter((e) => e.kind === "payment");
  const notes = exhibits.find((e) => e.kind === "note");
  const noted = notes?.lines?.find((l) => /refund/i.test(l));
  const done = refund && /Completed/i.test(fact(refund, "Status") ?? "");
  // A second order in the store's own records: two purchases, though PayPal's record of it isn't on file.
  const history = exhibits.find((e) => e.kind === "history");
  const second = [history, notes].find((e) => e?.lines?.some((l) => /\b(?:separate|second|two) orders?\b|\bsame box as this order\b/i.test(l)));
  return [
    done
      ? item("credit", "A credit on the duplicate, or two distinct transactions", "on file", `Refund ${fact(refund, "Refund")} of ${fact(refund, "Amount") ?? "the duplicate"}, completed`, letters(refund), true, "")
      : payments.length >= 2
        ? item("credit", "A credit on the duplicate, or two distinct transactions", "on file", `${payments.length} separate payments on file`, letters(...payments), true, "")
        : second
          ? item("credit", "A credit on the duplicate, or two distinct transactions", "weak", "The store's records show a second, separate order; its PayPal payment isn't on file", letters(history, notes), true, "Where is the second transaction, and what shows the buyer placed it?")
          : noted
          ? item("credit", "A credit on the duplicate, or two distinct transactions", "weak", "The seller's note says it was refunded; no refund record", letters(notes), true, "Where is the refund record for the duplicate charge?")
          : item("credit", "A credit on the duplicate, or two distinct transactions", "missing", "No refund and no second transaction on file", [], true, "What shows the duplicate was credited, or that these were two separate purchases?"),
    payments.length >= 2 || refund
      ? item("original", "The disputed charge is the one the buyer received", "on file", "The payment and its delivered order are on file", letters(...payments), false, "")
      : item("original", "The disputed charge is the one the buyer received", "weak", "One payment on file", letters(...payments), false, "Which of the two charges does this case dispute?"),
  ];
}

/** The requirements card for a case, or null when Exhibit has none for its reason. */
export function requirementsFor(c: { reason: string; amount: string | number; brand?: string | null; sandboxCode?: string | null }, exhibits: Exhibit[]): RequirementsCard | null {
  const brand = c.brand ?? brandOf(exhibits);
  const { network, code } = networkCode(c.reason, brand, c.sandboxCode);
  const amount = Number(c.amount);
  let items: Requirement[];
  let note: string | undefined;
  switch (c.reason) {
    case "MERCHANDISE_OR_SERVICE_NOT_RECEIVED":
      items = delivery(exhibits, amount);
      break;
    case "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED":
      items = described(exhibits);
      if (exhibits.some((e) => e.kind === "check")) {
        const check = exhibits.find((e) => e.kind === "check")!;
        const party = fact(check, "Responsible");
        items.push(
          party === "Cardholder"
            ? item("mandate", "The cardholder agreed to what the agent bought", "on file", "The mandate check holds the cardholder responsible", letters(check), true, "")
            : item("mandate", "The cardholder agreed to what the agent bought", "missing", "The agent's cart broke the cardholder's signed intent", letters(check), true, "The agent bought outside what the cardholder signed. Why is the cardholder bound by it?"),
        );
      }
      break;
    case "UNAUTHORISED":
      items = fraud(exhibits, network === "Visa");
      note = "A 3-D Secure result or compelling evidence (two earlier undisputed orders sharing the IP or device) is what moves a fraud case; address and security-code matches alone don't.";
      break;
    case "DUPLICATE_TRANSACTION":
      items = duplicate(exhibits);
      break;
    default:
      return null;
  }
  const required = items.filter((i) => i.required);
  let standing: RequirementsCard["standing"] = required.some((i) => i.status === "missing") ? "not met" : required.every((i) => i.status === "on file") ? "met" : "partly";
  // A fraud case without compelling evidence still has something when the parcel was signed for at the cardholder's address.
  if (c.reason === "UNAUTHORISED" && standing === "not met" && items.some((i) => i.id === "ship-billing" && i.status === "on file")) standing = "partly";
  return { network, code, title: TITLES[code] ?? code, items, standing, ...(note ? { note } : {}) };
}

/** The card as text, for the drafter's and the reviewer's prompts. */
export function cardText(card: RequirementsCard): string {
  const lines = card.items.map(
    (i) => `- [${i.status}${i.required ? "" : ", strengthens"}] ${i.need}: ${i.detail}${i.exhibits.length ? ` (Exhibit ${i.exhibits.join(", ")})` : ""}`,
  );
  return `${card.network} ${card.code}, ${card.title.toLowerCase()}. What it asks for, read from the exhibits by code (standing: ${card.standing}):\n${lines.join("\n")}${card.note ? `\n${card.note}` : ""}`;
}

/** Weak or missing items a reviewer should press: every required one, and any weak one the response leans on. */
export function pressable(card: RequirementsCard, response: { cites: string[] }[]): Requirement[] {
  const cited = new Set(response.flatMap((s) => s.cites));
  // A missing item that only strengthens the case is nothing the response can lean on; a weak one it cites is.
  return card.items.filter((i) => i.status !== "on file" && i.ask && (i.required || (i.status === "weak" && i.exhibits.some((e) => cited.has(e)))));
}
