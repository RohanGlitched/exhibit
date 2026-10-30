import { SHOP } from "../shop/catalog";
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
const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** "4 Oct 2026" (with or without a time after it) as a UTC day in ms, or null. */
const dateOf = (s?: string) => {
  const m = s?.match(/^(\d{1,2}) (\w{3})\w* (\d{4})/);
  const mi = m ? MON.indexOf(m[2].toLowerCase()) : -1;
  return m && mi >= 0 ? Date.UTC(Number(m[3]), mi, Number(m[1])) : null;
};
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

// "the vase just arrived today", "Found it at the front desk", "I got it": a parcel that reached the buyer. Not when
// a negation sits just before it ("still hasn't arrived", "never came"); "Never mind" is no negation.
const ARRIVED = /\b(?:arrived|turned up|showed up|came (?:today|yesterday|this morning|in the end))\b|\bfound (?:it|them|the (?:parcel|package|box|order))\b|\b(?:I|we)(?:'ve| have)? (?:got|received|picked up) (?:it|them|the (?:parcel|package|box|order)|my (?:parcel|package|order))\b/i;
const NEGATED = /^(?:not|never|no|hasn'?t|haven'?t|hadn'?t|didn'?t|isn'?t|wasn'?t|nothing)$/;
export function saysArrived(text: string): boolean {
  const t = text.replace(/[’]/g, "'").replace(/\bnever mind\b/gi, "");
  const m = ARRIVED.exec(t);
  if (!m) return false;
  const before = t.slice(0, m.index).toLowerCase().split(/[\s,.!?]+/).filter(Boolean).slice(-3);
  return !before.some((w) => NEGATED.test(w));
}
/** A short message quoted whole, a long one cut at 110 characters. */
const quote = (t: string) => `“${t.length > 110 ? `${t.slice(0, 109).trimEnd()}…` : t}”`;

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
  // The cardholder's own email saying the parcel arrived ("Never mind, the vase just arrived today"). Visa 13.1 and
  // Mastercard 4853 both take documentation that the cardholder received the goods (Visa Core Rules, dispute
  // condition 13.1 response; Mastercard Chargeback Guide, 4853 goods-not-received second presentment), so with no
  // carrier record it stands in for the scans: tracking, the delivered scan and the address only strengthen it.
  const inbox = by("inbox");
  const receipt = said(inbox, buyerName(exhibits)).find((l) => l.from === "buyer" && saysArrived(l.text));
  const viaReceipt = Boolean(receipt && !delivered);
  const out: Requirement[] = [];
  out.push(
    tracking && carrier && carrier !== "—" && number
      ? item("tracking", "Carrier and tracking number", "on file", `${carrier} ${number}, on file with PayPal`, letters(tracking), true, "")
      : scans
        ? item("tracking", "Carrier and tracking number", "weak", "Carrier scans, but no tracker on file with PayPal", letters(scans), !viaReceipt, "Where is the tracking number on file with PayPal for this parcel?")
        : item("tracking", "Carrier and tracking number", "missing", viaReceipt ? "No tracking on file; the cardholder's own email confirms receipt" : "No tracking on file", [], !viaReceipt, "What tracking shows this parcel was shipped at all?"),
  );
  out.push(
    delivered && date
      ? item("delivered", "A delivered scan with its date", "on file", `Delivered ${date}`, letters(scans), true, "")
      : item("delivered", "A delivered scan with its date", "missing", returned ? "The only delivered scan is back at the sender" : scans ? "No delivered scan" : "No carrier scans", letters(scans), !viaReceipt, "What carrier record shows the parcel delivered, and on what date?"),
  );
  out.push(
    delivered && shipZip && deliveredZip === shipZip
      ? item("address", "Delivered to the address on the transaction", "on file", `Delivered in ${deliveredZip}, the order's ship-to ZIP`, letters(scans, order), true, "")
      : delivered && shipZip && deliveredZip
        ? item("address", "Delivered to the address on the transaction", "missing", `Delivered in ${deliveredZip}; the order ships to ${shipZip}`, letters(scans, order), true, `The delivery scan is in ${deliveredZip} and the order ships to ${shipZip}: how was it delivered to the buyer's address?`)
        : item("address", "Delivered to the address on the transaction", delivered ? "weak" : "missing", delivered ? "The scan's ZIP can't be matched to the ship-to" : "Nothing shows where it was delivered", letters(scans, order), !viaReceipt, "Which page ties the delivery to the address on the order?"),
  );
  if (receipt)
    out.push(
      item(
        "admission",
        "The cardholder confirming receipt in writing",
        "on file",
        `The cardholder wrote that it arrived: ${quote(receipt.text)}`,
        letters(inbox),
        viaReceipt,
        "",
      ),
    );
  // Visa 13.1: delivered before the dispute, and within the delivery time; with no date agreed, Visa has the
  // cardholder wait 15 calendar days from the purchase before disputing non-receipt.
  const deliveredOn = dateOf(date);
  const orderedOn = dateOf(fact(order, "Ordered"));
  const opened = exhibits.find((e) => e.kind === "claim");
  const openedOn = dateOf(fact(opened, "Opened"));
  if (delivered && deliveredOn !== null && (orderedOn !== null || openedOn !== null)) {
    const days = orderedOn !== null ? Math.round((deliveredOn - orderedOn) / 86_400_000) : null;
    const after = openedOn !== null && deliveredOn > openedOn;
    const late = days !== null && days > 15;
    const by = letters(scans, ...(days !== null ? [order] : []), ...(openedOn !== null ? [opened] : []));
    const when = `${days !== null ? `${days} day${days === 1 ? "" : "s"} after the ${fact(order, "Ordered")!.replace(/,.*$/, "")} order` : "with no order date on file"}${openedOn !== null ? `${after ? ", after" : " and before"} the case opened on ${fact(opened, "Opened")}` : ""}`;
    out.push(
      after
        ? item("window", "Delivered before the dispute, within the delivery time", "missing", `Delivered ${date}, ${when}`, by, true, `The delivered scan is dated ${date}, after the case opened on ${fact(opened, "Opened")}. What shows the buyer had it before disputing?`)
        : late
          ? item("window", "Delivered before the dispute, within the delivery time", "weak", `Delivered ${date}, ${when}: later than the 15 days Visa allows when no delivery date was agreed`, by, true, `The parcel arrived ${days} days after the order. What delivery date was the buyer promised?`)
          : item("window", "Delivered before the dispute, within the delivery time", "on file", `Delivered ${date}, ${when}`, by, true, ""),
    );
  }
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
// The seller offering this buyer a return, in the words a shop writes: "You're welcome to return them within 30
// days for a refund", "you can return it", "return them within 30 days".
const OFFERS_RETURN =
  /\breturns? (?:are|is) accepted\b|\bwe (?:can|will|would) (?:take|accept) (?:it|them|the \w+) back\b|\bsend (?:it|them|the \w+) back\b|\breturn label\b|\bhappy to (?:take|accept) (?:it|them) back\b|\boffer(?:ed)? (?:a |you a )?return\b|\bwelcome to (?:return|send)\b|\byou (?:can|may|could) (?:always )?(?:return|send back)\b|\breturn (?:it|them|the \w+)(?: to us)? within \d+ days\b/i;
const DISCLOSES = /\bvar(?:y|ies|iation)\b|\bdiffer|\beach piece\b|\bno two\b|\bshifts?\b|\bmay (?:look|appear|show|differ)\b|\bunique\b/i;
// The cardholder sent the item back, or is sending it.
const RETURNED = /\b(?:I(?:'ve| have)?|we(?:'ve| have)?) (?:sent|posted|mailed|shipped|returned|dropped off) (?:it|them|the \w+)(?: back)?\b|\b(?:I'?ll|I will|I'?m going to) (?:send|post|mail|ship) (?:it|them|the \w+) back\b|\bposting (?:it|them) (?:back )?today\b|\byou (?:got|received|have) (?:the \w+|it|them) back\b|\breturn(?:ed)? (?:parcel|package|tracking)\b|\bthe returned \w+\b/i;
// The cardholder keeping the item, or refusing a return: "I'm keeping them", "Return shipping ... would be about
// $30. That doesn't seem fair."
const KEEPS = /\bI'?m keeping (?:it|them)\b|\bI(?:'ll| will) keep (?:it|them)\b|\b(?:won'?t|will not|not going to|refuse to) (?:send|return|post|pay for (?:the )?return)\b|\breturn shipping\b[^.]*\.?\s*(?:that )?(?:doesn'?t|does not|isn'?t|is not) (?:seem )?(?:fair|right|reasonable|worth)\b|\b(?:doesn'?t|does not) seem fair\b|\bnot (?:paying|going to pay) (?:for )?(?:the )?return\b/i;

/** An inbox line as "date, time, Name: text", split, with who wrote it: the shop, the buyer named on the order, or someone else. */
function said(inbox: Exhibit | undefined, buyer: string | undefined) {
  return (inbox?.lines ?? []).map((line) => {
    const m = line.replace(/[’]/g, "'").match(/^\d{1,2} \w{3} \d{4}, \d{2}:\d{2}, ([^:]+): ([\s\S]*)$/);
    const who = m?.[1]?.trim();
    // The shop's own name marks the seller's emails; the order's ship-to name the buyer's; anyone else is unknown.
    return { line, text: m?.[2] ?? line.replace(/[’]/g, "'"), from: who && who === SHOP.owner ? ("seller" as const) : who && who === buyer ? ("buyer" as const) : ("?" as const) };
  });
}
const buyerName = (exhibits: Exhibit[]) => fact(exhibits.find((e) => e.kind === "order"), "Ship to")?.split(",")[0]?.trim() || undefined;

function described(exhibits: Exhibit[]): Requirement[] {
  const by = (k: Exhibit["kind"]) => exhibits.find((e) => e.kind === k);
  const listing = by("listing");
  const policy = by("policy");
  const inbox = by("inbox");
  const notes = by("note");
  const text = (e?: Exhibit) => [...(e?.facts ?? []).map((f) => f.value), ...(e?.lines ?? [])].join(" ");
  const disclosed = DISCLOSES.test(text(listing)) ? listing : DISCLOSES.test(text(policy)) ? policy : undefined;
  const returnLine = /\breturns?\b/i.test(text(policy)) ? policy : undefined;
  const lines = said(inbox, buyerName(exhibits));
  // The seller's own email offering a return; a line from the buyer ("can I return them within 30 days?") isn't one.
  const offered = lines.find((l) => l.from !== "buyer" && OFFERS_RETURN.test(l.text));
  // Visa 13.3 and Mastercard 4853 ask the cardholder to return the item, or try to, before disputing it.
  const wrote = lines.find((l) => l.from !== "seller" && RETURNED.test(l.text));
  const noted = wrote ? undefined : notes?.lines?.find((t) => /\breturned \w+ (?:arrived|reached|came back)\b|\breturn tracking\b|\bwas returned\b/i.test(t));
  // Kept: the buyer says so, or turns down the return (what a return would cost them) in a line about returning.
  const kept = lines.find((l) => l.from !== "seller" && KEEPS.test(l.text) && /\breturn|\bkeep/i.test(l.text));
  // The words that carry the point: the whole message when it is short, else the sentence that matched.
  const quoted = (t: string, re?: RegExp) => {
    const part = t.length > 110 && re ? (t.split(/(?<=[.!?])\s+/).find((x) => re.test(x)) ?? t) : t;
    return `“${part.length > 110 ? `${part.slice(0, 109).trimEnd()}…` : part}”`;
  };
  const NEED = "Whether the cardholder returned the item, or tried to";
  const returned =
    wrote || noted
      ? item("returned", NEED, "missing", `The cardholder sent the item back: ${quoted(wrote?.text ?? noted!)}`, letters(wrote ? inbox : notes), true, "The buyer sent the item back. Where is the credit for the return?")
      : kept
        ? item("returned", NEED, "on file", `The cardholder kept the item and didn't return it: ${quoted(kept.text)}`, letters(inbox), false, "")
        : item("returned", NEED, "weak", "Nothing on file shows the item returned, or a return tried", letters(inbox), false, "Did the buyer return the item, or try to?");
  return [
    listing
      ? item("listing", "The item as it was described when sold", "on file", `The listing for ${listing.title.replace(/^Listing: /, "")}`, letters(listing), true, "")
      : item("listing", "The item as it was described when sold", "missing", "No listing on file", [], true, "What did the listing say the buyer was buying?"),
    returned,
    disclosed
      ? item("disclosure", "A disclosure of what the buyer complains about", "weak", `${disclosed.kind === "listing" ? "The listing" : "The policy"} discloses variation; whether it covers this complaint is a reading of the words`, letters(disclosed), true, "Where do the pages disclose the specific difference the buyer complains about?")
      : item("disclosure", "A disclosure of what the buyer complains about", "missing", "Nothing on file discloses a difference", letters(listing), true, "Where did the listing warn the buyer about the difference they complain about?"),
    returnLine
      ? item("return", "A return offered under the policy shown at checkout", offered ? "on file" : "weak", offered ? `The policy, and the seller offered a return by email: ${quoted(offered.text, OFFERS_RETURN)}` : "The policy offers returns; no email offering one", letters(policy, offered ? inbox : undefined), false, "Did the seller offer this buyer a return?")
      : offered
        ? item("return", "A return offered under the policy shown at checkout", "weak", `No return policy on file, but the seller offered a return by email: ${quoted(offered.text, OFFERS_RETURN)}`, letters(inbox), false, "Where is the return policy the buyer saw at checkout?")
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
  const undisputed = (l: string) => /\bnever disputed\b|\bno dispute\b/i.test(l) || !/disput|chargeback/i.test(l);
  const prior = (history?.lines ?? []).filter((l) => !/^First order/.test(l) && /no issues|delivered/i.test(l) && undisputed(l));
  const device = (notes?.lines ?? []).find((l) => /\bdevice\b|\bIP\b|\bbrowser\b/i.test(l));
  // The customer's own history, by network, read from the store's checkout log. Each network's route is its own:
  // - Visa 10.4 "Other Fraud: Card-Absent Environment", Compelling Evidence 3.0 (Visa Core Rules and Visa Product
  //   and Service Rules, in force from 15 April 2023): at least two earlier undisputed transactions on the same card,
  //   120 to 365 days before the dispute, each sharing with the disputed transaction the IP address or the device
  //   id, plus at least one more of: IP address, device id, shipping address, account login.
  // - Mastercard 4837 "No Cardholder Authorization" (Mastercard Chargeback Guide, Merchant Edition, second
  //   presentment): documentation that the cardholder took part in the transaction, such as earlier undisputed
  //   transactions from the same device or with the same details. The guide sets no CE 3.0-style day window or count,
  //   so none is applied here.
  const thisDevice = fact(history, "This order's device");
  const thisIp = fact(history, "This order's IP address");
  const ageOf = (l: string) => Number(l.match(/, (\d+) days ago\b/)?.[1] ?? NaN);
  const shared = (l: string) => {
    const dev = l.match(/\bDevice ([A-Z0-9-]+)/)?.[1];
    const ip = l.match(/\bIP address (\d{1,3}(?:\.\d{1,3}){3})/)?.[1];
    return { device: !!thisDevice && dev === thisDevice, ip: !!thisIp && ip === thisIp, address: /\bsame address\b/i.test(l) };
  };
  const sameSession = prior.filter((l) => {
    const s = shared(l);
    if (!s.device && !s.ip) return false;
    if (!visa) return true;
    const days = ageOf(l);
    return days >= 120 && days <= 365 && [s.device, s.ip, s.address].filter(Boolean).length >= 2;
  });
  // What the matching orders share, and their ages as the order book prints them ("211 and 146 days old").
  const and = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : (xs[0] ?? ""));
  const ages = and(sameSession.map(ageOf).filter((n) => Number.isFinite(n)).map(String));
  const sharedWords = (() => {
    const all = sameSession.map(shared);
    const what = [all.every((s) => s.device) ? "device" : "", all.every((s) => s.ip) ? "IP address" : ""].filter(Boolean);
    return what.length ? `the same ${and(what)}` : "the same device or IP address";
  })();
  const PRIOR_NEED = visa ? "Compelling Evidence 3.0: two earlier undisputed transactions, 120 to 365 days old" : "Earlier undisputed orders from the same device or with the same details";
  const delivered = scans?.lines?.find((l) => /\bDelivered\b/.test(l) && !/to sender/i.test(l));
  const home = delivered && zipOf(delivered) === zipOf(fact(order, "Ship to")) && !billing;
  // Signed for in the cardholder's own name ("Signed for by L PENNINGTON" on Laura Pennington's card).
  const holder = (fact(order, "Paid with")?.match(/in the name of (.+)$/)?.[1] ?? buyerName(exhibits) ?? "").trim();
  const signer = delivered?.match(/Signed for by ([A-Z][A-Za-z.'’ -]*?)(?: at\b|[.,]|$)/)?.[1]?.trim();
  const signedByHolder = (() => {
    if (!holder || !signer) return false;
    const h = holder.toUpperCase().split(/\s+/);
    const s = signer.toUpperCase().replace(/\./g, "").split(/\s+/);
    return s.at(-1) === h.at(-1) && s[0]?.[0] === h[0]?.[0];
  })();
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
  const orders = (n: number) => `${n} earlier order${n === 1 ? "" : "s"}`;
  // The card prints the orders' own ages, as Exhibit L does, not the rule's window: a drafter quotes what it reads.
  out.push(
    (visa ? sameSession.length >= 2 : sameSession.length >= 1)
      ? item("prior", PRIOR_NEED, "on file", `${orders(sameSession.length)}, ${ages} days old, never disputed, from ${sharedWords} as this one`, letters(history), true, "")
      : prior.length >= 2 || (!visa && prior.length === 1)
        ? item(
            "prior",
            PRIOR_NEED,
            "weak",
            visa
              ? `${orders(prior.length)} delivered without dispute (${and(prior.map(ageOf).filter((n) => Number.isFinite(n)).map(String))} days old); CE 3.0 needs two of them 120 to 365 days old that share the IP address or device id with this one, plus one more identifier`
              : `${orders(prior.length)} delivered without dispute; none on file shares this order's device or IP address`,
            letters(history),
            true,
            "Do the earlier orders share an IP address or device id with this one?",
          )
        : prior.length === 1
          ? item("prior", PRIOR_NEED, "weak", "One earlier order; CE 3.0 asks for two", letters(history), true, "One earlier order isn't two. What else ties the cardholder to this order?")
          : item("prior", PRIOR_NEED, "missing", "No earlier orders from this customer", letters(history), true, "This is the customer's first order. What ties the cardholder to it?"),
  );
  out.push(
    sameSession.length && thisDevice
      ? item("device", "A matching IP address or device id", "on file", `This order came from device ${thisDevice}${thisIp ? `, IP address ${thisIp}` : ""}, as the earlier orders did`, letters(history), true, "")
      : device
      ? item("device", "A matching IP address or device id", "weak", "The seller's note names the same device, but no IP or device id is on file", letters(notes), true, "What device id or IP address shows this was the same device?")
      : item("device", "A matching IP address or device id", "missing", "No IP address or device id on file", [], true, "What IP address or device id ties this order to the cardholder?"),
  );
  out.push(
    billing
      ? item("ship-billing", "Shipped to the cardholder's billing address", "missing", "Shipped somewhere other than the billing address", letters(payment, order), false, "The parcel shipped away from the billing address. Why does that point to the cardholder?")
      : home && /\bsigned\b/i.test(delivered!)
        ? item(
            "ship-billing",
            "Shipped to the cardholder's billing address",
            "on file",
            signedByHolder
              ? `Delivered to the order's address, which is the billing address, and signed for as ${signer}, the cardholder's name`
              : "Delivered and signed for at the order's address, which is the billing address",
            letters(scans, order),
            false,
            "",
          )
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

/**
 * On an order a buyer's AI agent placed, a not-received or not-as-described response has to say, in one sentence
 * citing the mandate exhibits, that the cardholder's signed intent covered this cart and ship-to address and that the
 * PayPal order carries the cart's SHA-256. The checker holds that sentence's figures to the exhibits it cites.
 */
export function agentOrderItem(exhibits: Exhibit[]): Requirement | null {
  const check = exhibits.find((e) => e.kind === "check");
  if (!check) return null;
  const mandates = exhibits.filter((e) => e.kind === "mandate");
  const need = "One sentence tying the agent's order to the cardholder: the signed intent covered this cart and ship-to address, and the PayPal order carries the cart's SHA-256";
  return fact(check, "Responsible") === "Cardholder" && mandates.length
    ? item("agent-order", need, "on file", "The signed intent and cart verify, the cart matches the intent, and the order's custom_id carries the cart's digest", letters(check, ...mandates), true, "Where does the response show the cardholder's signed intent covered this cart and ship-to address?")
    : item("agent-order", need, "missing", "The agent's cart broke the cardholder's signed intent, or no mandate is on file", letters(check, ...mandates), true, "The agent bought outside what the cardholder signed. Why is the cardholder bound by it?");
}

/** The requirements card for a case, or null when Exhibit has none for its reason. */
export function requirementsFor(c: { reason: string; amount: string | number; brand?: string | null; sandboxCode?: string | null }, exhibits: Exhibit[]): RequirementsCard | null {
  const brand = c.brand ?? brandOf(exhibits);
  const { network, code } = networkCode(c.reason, brand, c.sandboxCode);
  const amount = Number(c.amount);
  let items: Requirement[];
  let note: string | undefined;
  switch (c.reason) {
    case "MERCHANDISE_OR_SERVICE_NOT_RECEIVED": {
      items = delivery(exhibits, amount);
      const agentOrder = agentOrderItem(exhibits);
      if (agentOrder) items.push(agentOrder);
      break;
    }
    case "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED":
      items = described(exhibits);
      {
        const agentOrder = agentOrderItem(exhibits);
        if (agentOrder) items.push(agentOrder);
      }
      break;
    case "UNAUTHORISED":
      items = fraud(exhibits, network === "Visa");
      note =
        network === "Visa"
          ? "A 3-D Secure result or Compelling Evidence 3.0 (two earlier undisputed transactions 120 to 365 days old sharing the IP address or device id, plus one more identifier) is what moves a Visa 10.4 case; address and security-code matches alone don't."
          : `A 3-D Secure result, or evidence the cardholder took part (earlier undisputed orders from the same device or with the same details), is what moves ${network === "Mastercard" ? "a Mastercard 4837" : "an unauthorised-transaction"} case; address and security-code matches alone don't.`;
      if (
        items.some((i) => i.id === "ship-billing" && i.status === "on file" && /the cardholder's name$/.test(i.detail)) &&
        !items.some((i) => i.id === "prior" && i.status === "on file")
      )
        note += " Without either, delivery signed for in the cardholder's own name at the billing address is the record that the cardholder took part; it is weaker than both.";
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
