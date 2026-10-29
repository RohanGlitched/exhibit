import { test } from "node:test";
import assert from "node:assert/strict";
import { contentWords, stem, wordingMatch } from "../lib/cases/wording.ts";
import type { Exhibit } from "../lib/cases/types.ts";

const text = (e: Exhibit) => [e.title, ...e.facts.map((f) => `${f.label}: ${f.value}`), ...(e.lines ?? [])].join("\n");
const listing: Exhibit = {
  id: "G",
  kind: "listing",
  title: "Listing: Nesting bowls, set of three",
  source: "Store",
  facts: [],
  lines: ["Three nesting serving bowls in tide-blue glaze. Each set is unique; colour shifts from deep blue to green where the glaze pools."],
};
const inbox: Exhibit = { id: "F", kind: "inbox", title: "Emails with the buyer", source: "Store", facts: [], lines: ["Return shipping for three bowls would be about $30. That doesn't seem fair."] };

test("second pass: content words, stems and role words", () => {
  assert.deepEqual(contentWords("We told the buyer the glaze pools green."), ["told", "glaze", "pools", "green"]);
  assert.equal(stem("delivered"), stem("delivery"));
  assert.equal(stem("bowls"), stem("bowl"));
});

test("second pass: an unverified sentence passes only on the words of the exhibits it cites", () => {
  const ok = wordingMatch("Our listing says the colour shifts from deep blue to green where the glaze pools.", [listing], text);
  assert.equal(ok.matched, true);
  assert.deepEqual(ok.missing, ["says"]);
  // The same sentence citing the buyer's email instead: its words aren't there.
  assert.equal(wordingMatch("Our listing says the colour shifts from deep blue to green where the glaze pools.", [inbox], text).matched, false);
  const off = wordingMatch("The buyer agreed the bowls matched the photos and withdrew the complaint.", [listing], text);
  assert.equal(off.matched, false);
  assert.ok(off.missing.includes("agreed"));
});

test("toolkit reads: links dropped, long reads cut, one line for the case page", async () => {
  const { compactRead, readSummary, MAX_READS, DRAFTER_READS } = await import("../lib/cases/reads.ts");
  assert.equal(MAX_READS, 3);
  assert.deepEqual([...DRAFTER_READS], ["get_dispute", "get_shipment_tracking", "get_refund", "get_order"]);
  assert.equal(compactRead({ status: "RESOLVED", links: [{ href: "x" }], nested: { links: [], a: 1 } }), '{"status":"RESOLVED","nested":{"a":1}}');
  assert.match(compactRead({ s: "x".repeat(50) }, 20), /…\(cut\)$/);
  assert.equal(
    readSummary("get_dispute", { status: "RESOLVED", dispute_life_cycle_stage: "CHARGEBACK", dispute_amount: { value: "136.00" }, seller_response_due_date: "2026-11-08T23:59:59.000Z" }),
    "RESOLVED, CHARGEBACK, $136.00, respond by 2026-11-08",
  );
  assert.equal(readSummary("get_shipment_tracking", { trackers: [{ carrier: "USPS", tracking_number: "9405", status: "SHIPPED" }] }), "USPS 9405 SHIPPED");
  assert.equal(readSummary("get_shipment_tracking", {}), "no tracker on file");
});
