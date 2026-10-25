import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSentence, checkTally, figures, oddsFrom } from "../lib/cases/verify.ts";
import type { Exhibit } from "../lib/cases/types.ts";

const text = (e: Exhibit) => [e.title, e.ref ?? "", ...e.facts.map((f) => `${f.label}: ${f.value}`), ...(e.lines ?? [])].join("\n");

const EX: Exhibit[] = [
  {
    id: "A",
    kind: "claim",
    title: "The buyer's claim: not received",
    source: "PayPal",
    ref: "PP-R-OCC-10190303",
    facts: [
      { label: "Case", value: "PP-R-OCC-10190303" },
      { label: "Amount disputed", value: "$104.00" },
    ],
  },
  {
    id: "E",
    kind: "scans",
    title: "USPS scan history",
    source: "USPS",
    facts: [],
    lines: ["25 Sep 2026, 23:00  In transit, Sacramento", "27 Sep 2026, 13:00  Delivered, signed, San Francisco, CA 94109"],
  },
  {
    id: "D",
    kind: "tracking",
    title: "Tracking on file with PayPal",
    source: "PayPal",
    facts: [{ label: "Tracking number", value: "9405511206213859470035" }],
  },
];

test("keeps a sentence whose figures all appear in what it cites", () => {
  const s = checkSentence({ text: "USPS delivered it on 27 Sep 2026, 13:00, signed for.", cites: ["E"] }, EX, text);
  assert.equal(s.kept, true);
});

test("strikes a sentence with no citation", () => {
  const s = checkSentence({ text: "We shipped it promptly.", cites: [] }, EX, text);
  assert.equal(s.kept, false);
  assert.match(s.why!, /No exhibit cited/);
});

test("strikes a citation to an exhibit that doesn't exist", () => {
  const s = checkSentence({ text: "It was delivered.", cites: ["Z"] }, EX, text);
  assert.equal(s.kept, false);
});

test("strikes a wrong amount", () => {
  const s = checkSentence({ text: "The buyer disputes $140.00.", cites: ["A"] }, EX, text);
  assert.equal(s.kept, false);
  assert.match(s.why!, /\$140\.00/);
});

test("accepts an amount written without cents or with a comma", () => {
  assert.equal(checkSentence({ text: "The buyer disputes $104.", cites: ["A"] }, EX, text).kept, true);
});

test("strikes a date that only exists in another exhibit", () => {
  const s = checkSentence({ text: "It was delivered on 27 Sep 2026.", cites: ["A"] }, EX, text);
  assert.equal(s.kept, false);
});

test("strikes a date and time taken from two different scans", () => {
  const s = checkSentence({ text: "USPS delivered it on 25 Sep 2026, 13:00.", cites: ["E"] }, EX, text);
  assert.equal(s.kept, false);
  assert.match(s.why!, /25 Sep 2026, 13:00/);
});

test("accepts full month names for a date in the exhibit", () => {
  assert.equal(checkSentence({ text: "It arrived on 27 September 2026.", cites: ["E"] }, EX, text).kept, true);
});

test("reads a date written the American way or as ISO", () => {
  assert.equal(checkSentence({ text: "It arrived on September 27, 2026.", cites: ["E"] }, EX, text).kept, true);
  assert.equal(checkSentence({ text: "It arrived on Sept. 27th, 2026.", cites: ["E"] }, EX, text).kept, true);
  assert.equal(checkSentence({ text: "It arrived on 2026-09-27.", cites: ["E"] }, EX, text).kept, true);
  const s = checkSentence({ text: "It arrived on Sep 29, 2026.", cites: ["E"] }, EX, text);
  assert.equal(s.kept, false);
  assert.match(s.why!, /Sep 29, 2026/);
  assert.equal(checkSentence({ text: "It arrived on 2026-09-29.", cites: ["E"] }, EX, text).kept, false);
});

test("reads a 12-hour time", () => {
  assert.equal(checkSentence({ text: "USPS delivered it at 1:00 pm.", cites: ["E"] }, EX, text).kept, true);
  assert.equal(checkSentence({ text: "USPS delivered it at 1 p.m.", cites: ["E"] }, EX, text).kept, true);
  assert.equal(checkSentence({ text: "USPS delivered it at 11:00 am.", cites: ["E"] }, EX, text).kept, false);
  assert.equal(checkSentence({ text: "USPS delivered it at 11 PM.", cites: ["E"] }, EX, text).kept, true);
});

test("strikes a tracking number with one digit changed", () => {
  const s = checkSentence({ text: "Tracking number 9405511206213859470036 shows it shipped.", cites: ["D"] }, EX, text);
  assert.equal(s.kept, false);
});

test("finds figures in a sentence", () => {
  const f = figures("Refund 6ED91706RN309632X of $46.00 on 4 Oct 2026, 22:59.");
  assert.deepEqual(f.money, ["$46.00"]);
  assert.deepEqual(f.dates, ["4 Oct 2026"]);
  assert.deepEqual(f.times, ["22:59"]);
  assert.deepEqual(f.ids, ["6ED91706RN309632X"]);
});

test("drops tally points without a real citation and clamps weights", () => {
  const t = checkTally(
    [
      { side: "seller", point: "Delivered", weight: 5 as 3, cites: ["E"] },
      { side: "buyer", point: "Says not received", weight: 0 as 1, cites: ["Q"] },
    ],
    EX,
  );
  assert.equal(t.length, 1);
  assert.equal(t[0].weight, 3);
});

test("odds follow the weight on each side and stay off the extremes", () => {
  assert.equal(oddsFrom([]), 50);
  assert.equal(oddsFrom([{ side: "seller", point: "", weight: 3, cites: ["E"] }]), 97);
  assert.equal(
    oddsFrom([
      { side: "seller", point: "", weight: 3, cites: ["E"] },
      { side: "buyer", point: "", weight: 1, cites: ["A"] },
    ]),
    75,
  );
});

/* ───────────── Names, places, counts, recombination and denials ───────────── */

const CASE: Exhibit[] = [
  {
    id: "B",
    kind: "order",
    title: "The order",
    source: "PayPal",
    ref: "7XK39201LM5520114",
    facts: [
      { label: "Store order", value: "HC-622449" },
      { label: "Total", value: "$46.00" },
      { label: "Ship to", value: "Maya Lindqvist, 1418 Larkin Street, Apt 5, San Francisco, CA 94109" },
      { label: "Paid with", value: "VISA ending 1881 in the name of Maya Lindqvist" },
      { label: "Ordered", value: "26 Sep 2026, 22:00" },
    ],
    lines: ["2 × Slate speckle mug, 12 oz, $23.00"],
  },
  {
    id: "D",
    kind: "refund",
    title: "Refund of the duplicate charge",
    source: "PayPal",
    ref: "0LG80962XY4476054",
    facts: [
      { label: "Refund", value: "0LG80962XY4476054" },
      { label: "Amount", value: "$46.00" },
      { label: "Refunded", value: "7 Oct 2026, 22:00" },
    ],
  },
  {
    id: "E",
    kind: "scans",
    title: "USPS scan history",
    source: "USPS tracking · 9405511206213859470035",
    ref: "9405511206213859470035",
    facts: [{ label: "Latest", value: "Delivered, signed" }],
    lines: [
      "27 Sep 2026, 18:00  Accepted, Portland, OR 97214",
      "1 Oct 2026, 11:00  Delivered, signed, San Francisco, CA 94109. Signed for by M LINDQVIST at front desk",
    ],
  },
  {
    id: "F",
    kind: "inbox",
    title: "Emails with the buyer",
    source: "Store inbox",
    facts: [{ label: "Messages", value: "2" }],
    lines: ["5 Oct 2026, 09:10, Maya Lindqvist: Where is my order?", "5 Oct 2026, 15:00, Ines Halden: USPS shows it delivered and signed for at your front desk."],
  },
  {
    id: "G",
    kind: "scans",
    title: "USPS scan history",
    source: "USPS tracking",
    facts: [{ label: "Latest", value: "Delivered" }],
    lines: ["1 Oct 2026, 11:00  Delivered, Philadelphia, PA 19106. Left at front door"],
  },
];
const check = (t: string, cites: string[], quote?: string) => checkSentence({ text: t, cites, quote }, CASE, text);

test("keeps true sentences that name the carrier, signer, place, ZIP, card and count", () => {
  for (const [t, c] of [
    ["USPS delivered it to San Francisco, CA 94109 on 1 Oct 2026 at 11:00, signed for by M LINDQVIST.", ["E"]],
    ["The buyer paid $46.00 with a VISA ending 1881 for store order HC-622449.", ["B"]],
    ["The order was for two Slate speckle mugs.", ["B"]],
    ["USPS accepted the parcel in Portland, OR 97214 on 27 Sep 2026.", ["E"]],
  ] as [string, string[]][]) {
    const s = check(t, c);
    assert.equal(s.kept, true, `${t} -> ${s.why}`);
    assert.equal(s.unverified, undefined);
    assert.ok(s.checked!.length > 0);
  }
});

test("strikes a carrier the record doesn't name", () => {
  const s = check("FedEx delivered the parcel on 1 Oct 2026.", ["E"]);
  assert.equal(s.kept, false);
  assert.match(s.why!, /FedEx as the carrier/);
  assert.equal(check("UPS delivered it.", ["E"]).kept, false); // "UPS" is not read inside "USPS"
});

test("strikes the wrong signer", () => {
  const s = check("The parcel was signed for by J SMITH.", ["E"]);
  assert.equal(s.kept, false);
  assert.match(s.why!, /J SMITH as the person who signed/);
  assert.equal(check("The parcel was signed for by K LINDQVIST.", ["E"]).kept, false);
});

test("strikes a wrong ZIP, a wrong city and a wrong card last-4", () => {
  assert.match(check("USPS delivered it in San Francisco, CA 94110.", ["E"]).why!, /94110/);
  assert.match(check("USPS delivered it in Oakland, CA 94109.", ["E"]).why!, /Oakland, CA/);
  assert.match(check("The buyer paid with a VISA ending 4242.", ["B"]).why!, /4242/);
});

test("strikes a count, a percentage or a spelled-out amount the record doesn't hold", () => {
  assert.equal(check("The buyer ordered 3 mugs.", ["B"]).kept, false); // "3" isn't read inside a date
  assert.equal(check("The buyer ordered three mugs.", ["B"]).kept, false);
  assert.match(check("The buyer has a 90% dispute rate.", ["B"]).why!, /90%/);
  assert.equal(check("The order cost one hundred and forty dollars.", ["B"]).kept, false);
  assert.equal(check("The buyer only complained 30 days after delivery.", ["E", "F"]).kept, false);
});

test("reads amounts written without a dollar sign", () => {
  assert.equal(check("The order total was 46.00 USD.", ["B"]).kept, true);
  assert.match(check("The order total was 140.00 USD.", ["B"]).why!, /140\.00 USD/);
  assert.equal(check("The order total was USD 140.", ["B"]).kept, false);
});

test("checks a date written without a year against the day and month on record", () => {
  assert.equal(check("USPS delivered it on 1 Oct.", ["E"]).kept, true);
  assert.equal(check("USPS delivered it on October 1st.", ["E"]).kept, true);
  const s = check("USPS delivered it on October 9.", ["E"]);
  assert.equal(s.kept, false);
  assert.match(s.why!, /October 9/);
});

test("strikes figures recombined from two records into one clause", () => {
  // Both dates and both places are real, but the delivery line is in San Francisco on 1 Oct and Portland is the 27 Sep scan.
  const s = check("USPS delivered it in Portland, OR on 1 Oct 2026.", ["E"]);
  assert.equal(s.kept, false);
  assert.match(s.why!, /different records/);
  // Two clauses may rest on two records.
  assert.equal(check("USPS accepted it in Portland, OR on 27 Sep 2026, and delivered it in San Francisco, CA on 1 Oct 2026.", ["E"]).kept, true);
});

test("strikes a real date presented as the wrong event", () => {
  const s = check("We refunded $46.00 on 26 Sep 2026, before the buyer complained.", ["B", "D"]);
  assert.equal(s.kept, false);
  assert.match(s.why!, /26 Sep 2026 is in Exhibit B as “Ordered: 26 Sep 2026, 22:00”, not as the date of a refund/);
  assert.equal(check("Refund 0LG80962XY4476054 was issued on 1 Oct 2026.", ["D", "E"]).kept, false);
  assert.equal(check("We refunded $46.00 on 7 Oct 2026, 22:00.", ["D"]).kept, true);
  assert.equal(check("The buyer emailed us on 5 Oct 2026.", ["F"]).kept, true); // an inbox line is a message
});

test("strikes a real amount presented as the wrong kind of amount", () => {
  // $23.00 is the mug's unit price on the order line, not the total.
  const s = check("The buyer paid an order total of $23.00.", ["B"]);
  assert.equal(s.kept, false);
  assert.match(s.why!, /\$23\.00 is in Exhibit B as “2 × Slate speckle mug, 12 oz, \$23\.00”, not as the total/);
  assert.equal(check("The order total was $46.00, for two mugs at $23.00 each.", ["B"]).kept, true);
  assert.equal(check("We refunded $46.00 in full.", ["D"]).kept, true);
});

test("reads a pair of days written with one month and year", () => {
  assert.equal(check("The buyer and the shop wrote on 5 and 5 Oct 2026.", ["F"]).kept, true);
  const s = check("The buyer emailed on 4 and 5 Oct 2026.", ["F"]);
  assert.equal(s.kept, false);
  assert.match(s.why!, /4 Oct 2026/);
});

test("strikes a denial the cited record contradicts", () => {
  const s = check("USPS never delivered the parcel.", ["G"]);
  assert.equal(s.kept, false);
  assert.match(s.why!, /wasn't delivered/);
  assert.equal(check("The duplicate charge was not refunded.", ["D"]).kept, false);
  // About the evidence, not a denial; and reported speech is the buyer's claim.
  assert.equal(check("The tracking does not show delivery to the shipping address.", ["G"]).kept, true);
  assert.equal(check("The buyer reported that the order had not arrived.", ["F"]).kept, true);
});

test("strikes a signature no cited record shows", () => {
  const s = check("The parcel was signed for by the cardholder.", ["G"]);
  assert.equal(s.kept, false);
  assert.match(s.why!, /shows a signature/);
  assert.equal(check("The parcel was signed for at the front desk.", ["E"]).kept, true);
});

test("a quote must be in a cited exhibit, word for word", () => {
  const ok = check("USPS delivered it on 1 Oct 2026, signed for at the front desk.", ["E"], "Signed for by M LINDQVIST at front desk");
  assert.equal(ok.kept, true);
  assert.equal(ok.quote, "Signed for by M LINDQVIST at front desk");
  const bad = check("USPS delivered it on 1 Oct 2026.", ["E"], "Delivered to the buyer in person");
  assert.equal(bad.kept, false);
  assert.match(bad.why!, /words it quotes as proof aren't in Exhibit E/);
  // Quoted from an exhibit it doesn't cite.
  assert.equal(check("The buyer asked where it was.", ["E"], "Where is my order?").kept, false);
  // Curly quotes, spacing and an ellipsis are fine.
  assert.equal(check("The buyer asked where it was.", ["F"], "“Where is my  order?”").kept, true);
  assert.equal(check("We told the buyer it was signed for.", ["F"], "USPS shows it delivered … at your front desk").kept, true);
});

test("a sentence with nothing to check is kept but marked unverified, not checked", () => {
  const s = check("In her email the buyer confirmed the parcel arrived safely and thanked us.", ["F"]);
  assert.equal(s.kept, true);
  assert.equal(s.unverified, true);
  assert.deepEqual(s.checked, []);
  const c = check("USPS delivered it on 1 Oct 2026.", ["E"]);
  assert.equal(c.unverified, undefined);
  assert.deepEqual(c.checked, ["USPS", "1 Oct 2026"]);
});

test("reads every kind of figure once", async () => {
  const { tokens } = await import("../lib/cases/verify.ts");
  const kinds = tokens("USPS delivered 2 mugs ($46.00) to San Francisco, CA 94109 on 1 Oct 2026, 11:00, signed for by M LINDQVIST; card ending 1881, 90%, three, Oct 5.").map((t) => `${t.kind}:${t.raw}`);
  assert.deepEqual(kinds, [
    "carrier:USPS",
    "number:2",
    "money:$46.00",
    "place:San Francisco, CA",
    "zip:94109",
    "date:1 Oct 2026",
    "time:11:00",
    "signer:M LINDQVIST",
    "number:1881",
    "percent:90%",
    "word:three",
    "day:Oct 5",
  ]);
});

test("cites given as one string are read as letters", async () => {
  const { citeList } = await import("../lib/cases/verify.ts");
  assert.deepEqual(citeList("B, D"), ["B", "D"]);
  assert.deepEqual(citeList("Exhibit E"), ["E"]);
  assert.deepEqual(citeList("D and E"), ["D", "E"]);
  assert.deepEqual(citeList(["e", "E"]), ["E"]);
  assert.deepEqual(citeList(undefined), []);
  const s = checkSentence({ text: "USPS delivered it on 27 Sep 2026, 13:00, signed for.", cites: "E" }, EX, text);
  assert.equal(s.kept, true);
});
