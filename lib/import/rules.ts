/**
 * The rules engine for a pasted case: a plain brief from fixed rules, used when the model isn't available or the
 * visitor's model budget is spent. It reads only the exhibits and the requirements card, writes nothing it can't
 * cite, and every sentence and tally point goes through the same checker as the model's (lib/cases/verify.ts).
 * The demo shop's rules engine (lib/cases/brief.ts) assumes Halden Ceramics' own policies; this one assumes
 * nothing about the seller. Safe to import from client code.
 */
import type { Brief, BriefSentence, Exhibit, Recommendation, TallyItem } from "../cases/types";
import type { RequirementsCard } from "../cases/requirements";
import { checkSentence, checkTally, oddsFor, oddsFrom } from "../cases/verify";
import { exhibitText, type ImportedCase } from "./build";
import { fmtUsd } from "./parse";

type Draft = { text: string; cites: string[] };

const fact = (e: Exhibit | undefined, label: string) => e?.facts.find((f) => f.label === label)?.value;
const status = (card: RequirementsCard | null, id: string) => card?.items.find((i) => i.id === id)?.status;
/** The first sentence of a text that matches, for quoting a listing or a policy. */
const sentenceWith = (text: string, re: RegExp) => text.split(/(?<=[.!?])\s+/).find((s) => re.test(s))?.trim();
const DISCLOSES = /\bvar(?:y|ies|iation)\b|\bdiffer|\beach piece\b|\bno two\b|\bshifts?\b|\bmay (?:look|appear|show|differ)\b|\bunique\b/i;
const OFFERS_RETURN = /\breturns? (?:are|is) accepted\b|\bwe (?:can|will|would) (?:take|accept) (?:it|them|the \w+) back\b|\bsend (?:it|them) back\b|\breturn label\b|\bhappy to (?:take|accept) (?:it|them) back\b|\boffer(?:ed)? (?:a |you a )?return\b/i;
const KEEPS = /\b(?:I'?m|I am|I'?ll be|I will be|I'?d rather be) keeping\b|\bkeep (?:it|them|the \w+)\b(?! back)/i;
const DATE_AT = /^(\d{1,2} \w{3} \d{4})/;

export function argueImportWithRules(c: ImportedCase): Brief {
  const t0 = Date.now();
  const ex = c.exhibits;
  const by = (k: Exhibit["kind"]) => ex.find((e) => e.kind === k);
  const claim = by("claim")!;
  const order = by("order")!;
  const scans = by("scans");
  const tracking = by("tracking");
  const inbox = by("inbox");
  const listing = by("listing");
  const policy = by("policy");
  const history = by("history");
  const notes = by("note");
  const refund = by("refund");
  const payments = ex.filter((e) => e.kind === "payment");
  const card = c.card;
  const amount = fmtUsd(c.amount);
  const tally: TallyItem[] = [];
  const response: Draft[] = [];
  const evidence: string[] = [];
  let rec: Recommendation = "fight";
  let offer: string | undefined;
  const point = (side: TallyItem["side"], text: string, weight: 1 | 2 | 3, cites: (Exhibit | undefined)[]) => {
    const letters = cites.filter((e): e is Exhibit => !!e).map((e) => e.id);
    if (letters.length) tally.push({ side, point: text, weight, cites: letters });
  };
  const say = (text: string, ...cites: (Exhibit | undefined)[]) => {
    const letters = cites.filter((e): e is Exhibit => !!e).map((e) => e.id);
    if (letters.length) response.push({ text, cites: letters });
  };

  say(`The buyer paid ${fact(order, "Total")} for order ${fact(order, "Store order")} on ${fact(order, "Ordered")?.split(",")[0]}.`, order);

  switch (c.reason) {
    case "MERCHANDISE_OR_SERVICE_NOT_RECEIVED": {
      const delivered = scans?.lines?.find((l) => /\bDelivered\b/.test(l) && !/to sender/i.test(l));
      const returned = scans?.lines?.some((l) => /to sender/i.test(l));
      const elsewhere = status(card, "address") === "missing" && delivered;
      const signed = delivered && /\bsigned\b/i.test(delivered);
      if (delivered && !elsewhere) {
        point("seller", `The carrier shows the parcel delivered${signed ? " and signed for" : ""}.`, 3, [scans]);
        if (status(card, "address") === "on file") point("seller", "The delivery scan is in the ZIP the order shipped to.", 2, [scans, order]);
        if (tracking) point("seller", "The seller says the tracking number is on the PayPal transaction.", 1, [tracking]);
        else point("buyer", "Nothing shows the tracking number was added to the PayPal transaction.", 1, [scans]);
        say(`We shipped it with ${fact(scans, "Carrier")}, tracking number ${fact(scans, "Tracking number")}.`, scans);
        say(`The carrier's scan reads: ${delivered.replace(/\s+/g, " ")}.`, scans);
        if (status(card, "address") === "on file") say(`The order ships to ${fact(order, "Ship to")}.`, order);
        evidence.push("PROOF_OF_FULFILLMENT");
        if (signed) evidence.push("PROOF_OF_DELIVERY_SIGNATURE");
      } else {
        rec = "accept";
        if (elsewhere) point("buyer", "The delivery scan is in a different ZIP from the ship-to address.", 3, [scans, order]);
        else if (returned) point("buyer", "The carrier shows the parcel going back to the sender.", 3, [scans]);
        else if (scans?.lines?.length) point("buyer", "The carrier's scans stop before any delivery.", 3, [scans]);
        else point("buyer", "There are no carrier scans to show the parcel arrived.", 3, [scans ?? claim]);
        say(`We can't show delivery to the buyer's address for this order, so we are refunding ${amount} in full.`, claim);
        evidence.push("PROOF_OF_REFUND");
      }
      break;
    }

    case "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED": {
      const listingText = listing?.lines?.[0] ?? "";
      const disclosure = sentenceWith(listingText, DISCLOSES);
      const policyReturn = policy?.lines?.find((l) => /\breturns?\b/i.test(l));
      const offeredLine = inbox?.lines?.find((l) => OFFERS_RETURN.test(l) && !l.includes(`${c.head.buyer}:`));
      const keptLine = inbox?.lines?.find((l) => l.includes(`${c.head.buyer}:`) && KEEPS.test(l));
      if (disclosure) point("seller", "The listing discloses that the item can vary.", 2, [listing]);
      if (offeredLine) point("seller", "The seller offered the buyer a return by email.", 2, [inbox]);
      else if (policyReturn) point("seller", "The store's policy offers returns.", 1, [policy]);
      if (keptLine) point("seller", "The buyer wrote that they are keeping the item.", 2, [inbox]);
      point("buyer", "The buyer says the item isn't as described.", 2, [claim]);
      if (!listing) point("buyer", "No listing is on file to show what was described.", 2, [claim]);

      if (disclosure && (offeredLine || policyReturn)) rec = "fight";
      else if (c.canOffer) rec = "offer";
      else rec = disclosure ? "fight" : "accept";
      if (rec === "offer") offer = Math.max(1, Math.round(Number(c.amount) * 0.3)).toFixed(2);

      if (rec === "accept") {
        say(`Nothing on file shows the listing described the difference the buyer reports, so we are refunding ${amount} in full.`, claim);
        evidence.push("PROOF_OF_REFUND");
        break;
      }
      if (disclosure) say(`Our listing says: “${disclosure}”`, listing);
      if (offeredLine) {
        const day = offeredLine.match(DATE_AT)?.[1];
        say(day ? `We offered the buyer a return by email on ${day}.` : "We offered the buyer a return by email.", inbox);
      } else if (policyReturn) say(`Our store policy reads: “${policyReturn}”`, policy);
      if (keptLine) {
        const day = keptLine.match(DATE_AT)?.[1];
        say(day ? `On ${day}, the buyer wrote that they are keeping the item.` : "The buyer wrote that they are keeping the item.", inbox);
      }
      if (rec === "offer") say("We are offering a partial refund so the buyer can keep the item without paying for a return.", claim);
      evidence.push("ITEM_DESCRIPTION");
      if (policy || offeredLine) evidence.push("RETURN_POLICY");
      break;
    }

    case "UNAUTHORISED": {
      const prior = status(card, "prior");
      const shipBilling = status(card, "ship-billing");
      const admission = card?.items.find((i) => i.id === "admission");
      const billing = fact(payments[0], "Billing address");
      if (billing) point("buyer", "The billing address differs from the ship-to address.", 2, [payments[0]]);
      if (prior === "missing") point("buyer", "Nothing on file shows earlier orders from this customer.", 1, [history ?? order]);
      else if (history) point("seller", "The customer has earlier orders on file.", prior === "weak" ? 1 : 2, [history]);
      if (shipBilling === "on file") point("seller", "The parcel was signed for at the order's address.", 2, [scans]);
      else if (shipBilling === "weak") point("seller", "The parcel was delivered at the order's address.", 1, [scans]);
      if (admission) point("seller", "An email in the buyer's name acknowledges the order.", 2, [inbox]);
      const notesDevice = notes?.lines?.some((l) => /\bdevice\b|\bIP\b/i.test(l));
      if (notesDevice) point("seller", "The seller's notes mention a matching device or IP address.", 1, [notes]);
      const strong = (history && prior !== "missing" && earlier(history) >= 2) || admission || shipBilling === "on file";
      rec = strong && !billing ? "fight" : "accept";
      if (rec === "accept") {
        say(`Nothing on file ties the cardholder to this order strongly enough, so we are refunding ${amount}.`, claim);
        evidence.push("PROOF_OF_REFUND");
      } else {
        const delivered = scans?.lines?.find((l) => /\bDelivered\b/.test(l) && !/to sender/i.test(l));
        if (delivered) say(`The carrier's scan reads: ${delivered.replace(/\s+/g, " ")}.`, scans);
        if (history) say(`This customer has ${fact(history, "Earlier orders")} earlier orders with us.`, history);
        if (admission) say("The buyer acknowledged the order by email.", inbox);
        evidence.push("PROOF_OF_FULFILLMENT", "OTHER");
      }
      break;
    }

    case "DUPLICATE_TRANSACTION": {
      if (refund) {
        point("seller", "The duplicate charge was refunded.", 3, [refund]);
        say(`We refunded the duplicate charge: refund ${fact(refund, "Refund")}${fact(refund, "Amount") ? `, ${fact(refund, "Amount")}` : ""}.`, refund);
        evidence.push("PROOF_OF_REFUND");
      } else if (payments.length >= 2) {
        point("seller", "Each charge is its own payment on file.", 2, payments);
        say(`These are two separate payments: ${payments.map((p) => fact(p, "Payment")).filter(Boolean).join(" and ")}.`, ...payments);
        evidence.push("OTHER");
      } else {
        rec = "accept";
        point("buyer", "Nothing on file shows the duplicate was refunded or was a separate purchase.", 3, [claim]);
        say(`We can't show the second charge was refunded, so we are refunding ${amount}.`, claim);
        evidence.push("PROOF_OF_REFUND");
      }
      break;
    }
  }

  // The checker reads tally points too: a point whose figures aren't in what it cites is dropped.
  const keptTally = checkTally(tally, ex).filter((t) => checkSentence({ text: t.point, cites: t.cites }, ex, exhibitText).kept);
  const sentences: BriefSentence[] = response.map((r) => checkSentence(r, ex, exhibitText));
  const headline =
    rec === "fight" ? "The records you pasted support the seller. File the evidence." : rec === "offer" ? "A partial refund should settle this without a return." : "The records you pasted favour the buyer. Refund and close it.";
  return {
    recommendation: rec,
    ...(offer ? { offerAmount: offer } : {}),
    headline,
    sentences,
    tally: keptTally,
    odds: oddsFor(rec, oddsFrom(keptTally)),
    evidenceTypes: evidence.slice(0, 4),
    engine: "rules",
    ms: Date.now() - t0,
    createdAt: new Date().toISOString(),
  };
}

/** How many earlier orders a history exhibit lists. */
const earlier = (history: Exhibit) => Number(fact(history, "Earlier orders") ?? 0);
