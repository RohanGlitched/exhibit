import { test } from "node:test";
import assert from "node:assert/strict";
import { brandOf, cardText, networkCode, pressable, requirementsFor } from "../lib/cases/requirements.ts";
import { pressObjections, type Objection } from "../lib/cases/hearing.ts";
import type { Exhibit } from "../lib/cases/types.ts";

const order = (paid: string, shipTo = "Maya Lindqvist, 1418 Larkin Street, Apt 5, San Francisco, CA 94109"): Exhibit => ({
  id: "B",
  kind: "order",
  title: "The order",
  source: "PayPal",
  facts: [
    { label: "Total", value: "$46.00" },
    { label: "Ship to", value: shipTo },
    { label: "Paid with", value: paid },
  ],
});
const tracking: Exhibit = { id: "D", kind: "tracking", title: "Tracking", source: "PayPal", facts: [{ label: "Tracking number", value: "9405511206213859470035" }, { label: "Carrier", value: "USPS" }] };
const scans = (last: string): Exhibit => ({ id: "E", kind: "scans", title: "USPS scan history", source: "USPS", facts: [], lines: ["27 Sep 2026, 18:00  Accepted, Portland, OR 97214", last] });
const status = (card: ReturnType<typeof requirementsFor>, id: string) => card!.items.find((i) => i.id === id)?.status;

test("names the network's own code from the card brand and the reason", () => {
  assert.equal(brandOf([order("VISA ending 1881 in the name of Maya Lindqvist")]), "VISA");
  assert.deepEqual(networkCode("MERCHANDISE_OR_SERVICE_NOT_RECEIVED", "VISA"), { network: "Visa", code: "13.1" });
  assert.deepEqual(networkCode("MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", "VISA", "C2"), { network: "Visa", code: "13.3" });
  assert.deepEqual(networkCode("MERCHANDISE_OR_SERVICE_NOT_RECEIVED", "MASTERCARD", "4855"), { network: "Mastercard", code: "4853" });
  assert.deepEqual(networkCode("UNAUTHORISED", "MASTERCARD"), { network: "Mastercard", code: "4837" });
  assert.deepEqual(networkCode("DUPLICATE_TRANSACTION", "MASTERCARD"), { network: "Mastercard", code: "4834" });
});

test("Visa 13.1: tracking, a dated delivered scan, at the transaction's address", () => {
  const ok = requirementsFor({ reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", amount: "46.00" }, [order("VISA ending 1881"), tracking, scans("1 Oct 2026, 11:00  Delivered, San Francisco, CA 94109")]);
  assert.equal(ok!.code, "13.1");
  assert.equal(ok!.standing, "met");
  assert.equal(status(ok, "address"), "on file");
  assert.equal(status(ok, "signature"), "missing"); // not required under $750
  assert.equal(ok!.items.find((i) => i.id === "signature")!.required, false);

  const elsewhere = requirementsFor({ reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", amount: "46.00" }, [order("VISA ending 1881"), tracking, scans("1 Oct 2026, 11:00  Delivered, Reno, NV 89501")]);
  assert.equal(status(elsewhere, "address"), "missing");
  assert.equal(elsewhere!.standing, "not met");

  const none = requirementsFor({ reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", amount: "900.00" }, [order("VISA ending 1881")]);
  assert.equal(status(none, "tracking"), "missing");
  assert.equal(none!.items.find((i) => i.id === "signature")!.required, true); // over $750
});

test("Mastercard 4837: matched checks are weak, no 3-D Secure is said to be missing, CE history is counted", () => {
  const payment: Exhibit = { id: "C", kind: "payment", title: "The payment", source: "PayPal", facts: [{ label: "Address check", value: "Y: Street and ZIP match" }, { label: "Security code", value: "M: Security code matched" }] };
  const history: Exhibit = { id: "H", kind: "history", title: "History", source: "Store", facts: [], lines: ["#0988, 210 days ago: Mug, $46.00. Delivered, no issues.", "#1032, 120 days ago: Bowl, $27.00. Delivered, no issues."] };
  const card = requirementsFor({ reason: "UNAUTHORISED", amount: "180.00" }, [order("MASTERCARD ending 0011"), payment, history]);
  assert.equal(card!.code, "4837");
  assert.equal(status(card, "avs-cvv"), "weak");
  assert.equal(status(card, "3ds"), "missing");
  assert.match(card!.items.find((i) => i.id === "3ds")!.detail, /None on file/);
  assert.equal(status(card, "prior"), "weak"); // two orders, but no shared IP or device on file
  assert.equal(status(card, "device"), "missing");
  assert.match(cardText(card!), /Mastercard 4837/);
});

test("Mastercard 4834: a completed refund on the duplicate meets it", () => {
  const refund: Exhibit = { id: "D", kind: "refund", title: "Refund", source: "PayPal", facts: [{ label: "Refund", value: "0LG80962XY4476054" }, { label: "Status", value: "Completed" }, { label: "Amount", value: "$46.00" }] };
  assert.equal(requirementsFor({ reason: "DUPLICATE_TRANSACTION", amount: "46.00" }, [order("MASTERCARD ending 0011"), refund])!.standing, "met");
  assert.equal(requirementsFor({ reason: "DUPLICATE_TRANSACTION", amount: "46.00" }, [order("MASTERCARD ending 0011")])!.standing, "not met");
});

test("the card presses each weak or missing item the case needs, ahead of the reviewer's other objections", () => {
  const card = requirementsFor({ reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", amount: "46.00" }, [order("VISA ending 1881"), tracking, scans("1 Oct 2026, 11:00  Delivered, Reno, NV 89501")])!;
  const response = [{ text: "USPS delivered it on 1 Oct 2026.", cites: ["E"] }];
  assert.deepEqual(pressable(card, response).map((i) => i.id), ["address"]);
  const own: Objection = { n: 1, sentence: 0, text: "Is the tone of this sentence fair to the buyer?", ground: "omits", pages: [] };
  const pressed = pressObjections([own], card, response, (x) => (x === "E" ? "HC-000004" : undefined));
  assert.equal(pressed.length, 2);
  assert.equal(pressed[0].requirement, "address");
  assert.equal(pressed[0].pressed, true);
  assert.deepEqual(pressed[0].pages, ["HC-000004"]);
  assert.equal(pressed[1].text, own.text);
  assert.deepEqual(pressed.map((o) => o.n), [1, 2]);
  // The reviewer's own objection on that item is kept instead of the card's.
  const mine: Objection = { ...own, text: "The scan is in Reno. How did it reach San Francisco?", requirement: "address" };
  assert.equal(pressObjections([mine], card, response, () => undefined)[0].text, mine.text);
});

test("a fight with nothing weak and no objection is put to proof on the item it turns on", () => {
  const card = requirementsFor({ reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", amount: "46.00" }, [order("VISA ending 1881"), tracking, scans("1 Oct 2026, 11:00  Delivered, signed, San Francisco, CA 94109. Signed for by M LINDQVIST")])!;
  const pressed = pressObjections([], card, [{ text: "It was delivered.", cites: ["E"] }], () => undefined);
  assert.equal(pressed.length, 1);
  assert.equal(pressed[0].requirement, "tracking");
  assert.match(pressed[0].text, /^Show on the pages carrier and tracking number/);
});

test("a second order in the store's records is weak, not missing; a cardholder's written admission is listed", () => {
  const history: Exhibit = { id: "I", kind: "history", title: "History", source: "Store", facts: [], lines: ["#1146, 11 days ago: Slate speckle mug, 12 oz, $46.00. Shipped in the same box as this order, delivered."] };
  const dup = requirementsFor({ reason: "DUPLICATE_TRANSACTION", amount: "46.00" }, [order("MASTERCARD ending 0011"), history]);
  assert.equal(status(dup, "credit"), "weak");
  const inbox: Exhibit = { id: "F", kind: "inbox", title: "Emails", source: "Store", facts: [], lines: ["12 Oct 2026, 11:00, Daniel Brooks: I reported it before I realised it was my order from you. I'm keeping them."] };
  const fraud = requirementsFor({ reason: "UNAUTHORISED", amount: "180.00" }, [order("MASTERCARD ending 0011"), inbox]);
  assert.equal(status(fraud, "admission"), "weak");
  assert.equal(status(requirementsFor({ reason: "UNAUTHORISED", amount: "180.00" }, [order("MASTERCARD ending 0011")]), "admission"), undefined);
});
