import type { Dispute } from "../paypal/disputes";
import type { Exhibit } from "../cases/types";

/**
 * The stronger rules baseline for the eval: the fallback rules engine plus every check a rule can make on the
 * structured records alone. It compares the delivery scan's ZIP with the order's ship-to ZIP, looks for a
 * refund record, reads the issuer's address and security-code checks, compares billing with shipping, counts
 * earlier orders and reads the mandate check. It never reads free text (emails, notes, listing wording), so
 * where it and the model differ is what reading the text is worth.
 */

export interface StrongCall {
  call: "fight" | "accept";
  why: string;
}

const zipOf = (s?: string) => s?.match(/\b\d{5}\b(?!.*\b\d{5}\b)/)?.[0];

export function strongRules(d: Dispute, exhibits: Exhibit[]): StrongCall {
  const by = (k: Exhibit["kind"]) => exhibits.find((e) => e.kind === k);
  const fact = (e: Exhibit | undefined, label: string) => e?.facts.find((f) => f.label === label)?.value;

  const check = by("check");
  if (check) {
    const failed = (check.lines ?? []).find((l) => l.startsWith("Fail"));
    return failed ? { call: "accept", why: `Mandate check failed: ${failed.replace(/^Fail: /, "")}` } : { call: "fight", why: "Every mandate check passed." };
  }

  const order = by("order");
  const scans = by("scans");
  const shipZip = zipOf(fact(order, "Ship to"));
  const last = scans?.lines?.at(-1) ?? "";
  const delivered = /\bDelivered\b/.test(last) && !/to sender/i.test(last);
  const signed = /\bsigned\b/i.test(last);
  const deliveredHome = delivered && !!shipZip && zipOf(last) === shipZip;

  switch (d.reason) {
    case "MERCHANDISE_OR_SERVICE_NOT_RECEIVED":
      if (!scans) return { call: "accept", why: "No carrier scans." };
      return deliveredHome
        ? { call: "fight", why: `Delivered in the ship-to ZIP ${shipZip}.` }
        : { call: "accept", why: delivered ? `Delivered in ZIP ${zipOf(last)}, not the ship-to ZIP ${shipZip}.` : "No delivery scan." };
    case "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED":
      // Whether the listing disclosed the difference is only in its wording, which a rule doesn't read.
      return { call: "fight", why: "A listing and a return policy are on record; the records alone can't tell more." };
    case "UNAUTHORISED": {
      const payment = by("payment");
      const avs = fact(payment, "Address check") ?? "";
      const cvv = fact(payment, "Security code") ?? "";
      if (/^N\b/.test(avs) || /^N\b/.test(cvv)) return { call: "accept", why: "The issuer's address or security-code check failed." };
      if (fact(payment, "Billing address")) return { call: "accept", why: "Billing and shipping addresses differ." };
      const earlier = Number(fact(by("history"), "Earlier orders") ?? 0);
      if (deliveredHome && (signed || earlier > 0)) return { call: "fight", why: "Shipped to the billing address and delivered there." };
      return { call: "accept", why: "Nothing on record ties the cardholder to the order." };
    }
    case "DUPLICATE_TRANSACTION":
      return by("refund") ? { call: "fight", why: "A refund record is on file." } : { call: "accept", why: "No refund record." };
    default:
      return { call: "accept", why: "No rule for this reason." };
  }
}
