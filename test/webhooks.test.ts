import { test } from "node:test";
import assert from "node:assert/strict";
import { disputeIdOf, isDisputeEvent, utcStamp, verificationBody, webhookView } from "../lib/webhooks/paypal.ts";
import { argueBlocked, isFiled } from "../lib/cases/guard.ts";
import { inPool, refillPlan, untouched } from "../lib/cases/pool.ts";
import { deadlineProblems, readyForVisitor, refillProblem } from "../lib/health.ts";
import type { Brief, CaseRecord, Filing } from "../lib/cases/types.ts";

const headers = {
  "PAYPAL-AUTH-ALGO": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-a5cafa77",
  "paypal-transmission-id": "103e3700-8b0c-11e6-8695-6b62a8a99ac4",
  "paypal-transmission-sig": "t8Q2ijh4Kq1aB/xzoN6pE2Y3fhw==",
  "paypal-transmission-time": "2026-10-25T09:12:01Z",
};
// Spacing and key order as PayPal sent it; re-serialising would change both and break the signature.
const raw = '{"id":"WH-7Y7254563A4550640-11V2185806837105M","event_type":"CUSTOMER.DISPUTE.CREATED","resource":{"dispute_id": "PP-R-ABC-10190612" ,"status":"OPEN","amount":1.10}}';

test("verificationBody carries the five headers, the webhook id and the event byte for byte", () => {
  const body = verificationBody(headers, "8PT597110X687430LKGECATA", raw)!;
  const parsed = JSON.parse(body);
  assert.equal(parsed.auth_algo, "SHA256withRSA");
  assert.equal(parsed.cert_url, headers["paypal-cert-url"]);
  assert.equal(parsed.transmission_id, headers["paypal-transmission-id"]);
  assert.equal(parsed.transmission_sig, headers["paypal-transmission-sig"]);
  assert.equal(parsed.transmission_time, headers["paypal-transmission-time"]);
  assert.equal(parsed.webhook_id, "8PT597110X687430LKGECATA");
  assert.equal(parsed.webhook_event.resource.dispute_id, "PP-R-ABC-10190612");
  assert.ok(body.endsWith(`"webhook_event":${raw}}`), "the raw event is spliced in unchanged");
});

test("verificationBody reads a Headers object too", () => {
  const h = new Headers(headers);
  assert.ok(verificationBody(h, "WID", raw));
});

test("verificationBody refuses a missing header, a missing webhook id, or a body that isn't a JSON object", () => {
  const { "paypal-transmission-sig": _, ...missing } = headers;
  assert.equal(verificationBody(missing, "WID", raw), null);
  assert.equal(verificationBody({ ...headers, "paypal-transmission-sig": "  " }, "WID", raw), null);
  assert.equal(verificationBody(headers, "", raw), null);
  assert.equal(verificationBody(headers, "WID", "not json"), null);
  assert.equal(verificationBody(headers, "WID", "[1,2]"), null);
  assert.equal(verificationBody(headers, "WID", '{"a":1}, "webhook_id":"forged"'), null);
});

test("dispute events and their dispute id", () => {
  assert.ok(isDisputeEvent("CUSTOMER.DISPUTE.RESOLVED"));
  assert.ok(!isDisputeEvent("PAYMENT.CAPTURE.COMPLETED"));
  assert.equal(disputeIdOf(JSON.parse(raw)), "PP-R-ABC-10190612");
  assert.equal(disputeIdOf({ id: "WH-1", event_type: "CUSTOMER.DISPUTE.UPDATED", resource: { id: "PP-R-XYZ-1" } }), "PP-R-XYZ-1");
  assert.equal(disputeIdOf({ id: "WH-1", event_type: "CUSTOMER.DISPUTE.UPDATED", resource: { id: "CAP-1" } }), null);
});

const filing = (action: Filing["action"]): Filing => ({ at: "2026-10-25T10:00:00Z", action, summary: "", ok: true, by: "seller" });

test("argue guard: a filed or resolved case keeps its brief", () => {
  assert.equal(argueBlocked("WAITING_FOR_SELLER_RESPONSE", []), null);
  assert.equal(argueBlocked("OPEN", [filing("message"), filing("offer")]), null, "an offer or a message isn't a filing");
  assert.match(argueBlocked("UNDER_REVIEW", [filing("evidence")])!, /already filed/);
  assert.match(argueBlocked("WAITING_FOR_SELLER_RESPONSE", [filing("accept")])!, /already filed/);
  assert.match(argueBlocked("RESOLVED", [])!, /resolved/);
  assert.match(argueBlocked(undefined, [filing("evidence")])!, /already filed/, "checked on the stored record, without PayPal's status");
  assert.ok(isFiled([filing("ruling"), filing("evidence")]));
  assert.ok(!isFiled([filing("ruling")]));
});

const brief = (createdAt: string, engine: Brief["engine"] = "rules"): Brief => ({
  recommendation: "fight",
  headline: "",
  sentences: [],
  tally: [],
  odds: 80,
  evidenceTypes: [],
  engine,
  ms: 0,
  createdAt,
});
const rec = (over: Partial<CaseRecord> = {}): CaseRecord => ({ disputeId: "PP-R-ABC-10190612", openedAt: "2026-10-25T09:11:50Z", filings: [], ...over });
const autopilot = { eventId: "WH-1", receivedAt: "2026-10-25T09:12:01.500Z", arguedAt: "2026-10-25T09:12:07.900Z", briefAt: "2026-10-25T09:12:07.000Z", engine: "model" as const };

test("pool: an autopilot brief keeps a case in stock; anyone else's takes it out", () => {
  assert.ok(inPool(rec()));
  assert.ok(inPool(rec({ brief: brief(autopilot.briefAt, "model"), autopilot })));
  assert.ok(!inPool(rec({ brief: brief("2026-10-25T11:00:00Z"), autopilot })), "argued again since");
  assert.ok(!inPool(rec({ brief: brief(autopilot.briefAt) })), "argued by a visitor or over MCP");
  assert.ok(!inPool(rec({ claimedBy: "v1" })));
  assert.ok(!inPool(rec({ brief: brief(autopilot.briefAt), autopilot, filings: [filing("evidence")] })));
  assert.ok(!inPool(rec({ retired: "PayPal resolved it" })));
  assert.ok(untouched(rec({ retired: "PayPal resolved it" })));
});

test("refill plan fills empty stories first, then evens out, within the limit", () => {
  const stories = ["delivered", "damaged", "fraud", "duplicate"];
  assert.deepEqual(refillPlan({ delivered: 2, damaged: 1, fraud: 0, duplicate: 0 }, stories, 2, 3), ["fraud", "duplicate", "damaged"]);
  assert.deepEqual(refillPlan({ delivered: 0 }, stories, 2, 10), ["delivered", "damaged", "fraud", "duplicate", "delivered", "damaged", "fraud", "duplicate"]);
  assert.deepEqual(refillPlan({ delivered: 2, damaged: 2, fraud: 2, duplicate: 3 }, stories, 2, 6), []);
});

test("webhook view: received, argued N s later, and whether the brief is still the autopilot's", () => {
  assert.equal(webhookView(rec()), null);
  const v = webhookView(rec({ brief: brief(autopilot.briefAt, "model"), autopilot }))!;
  assert.equal(v.seconds, 6);
  assert.equal(v.current, true);
  assert.equal(v.engine, "model");
  assert.equal(webhookView(rec({ brief: brief("2026-10-26T00:00:00Z"), autopilot }))!.current, false);
  const r = webhookView(rec({ lastEvent: { id: "WH-2", type: "CUSTOMER.DISPUTE.RESOLVED", receivedAt: "2026-10-26T10:00:00Z", status: "RESOLVED", outcome: "RESOLVED_SELLER_FAVOUR" } }))!;
  assert.equal(r.receivedAt, null);
  assert.equal(r.last?.outcome, "RESOLVED_SELLER_FAVOUR");
  assert.equal(utcStamp("2026-10-25T09:12:01.500Z"), "25 Oct, 09:12 UTC");
});

const NOW = Date.parse("2026-11-01T12:00:00Z");
const inHours = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

test("health: a case is ready only with 36 hours or more to answer", () => {
  assert.ok(readyForVisitor("WAITING_FOR_SELLER_RESPONSE", inHours(36), NOW));
  assert.ok(readyForVisitor("WAITING_FOR_SELLER_RESPONSE", inHours(200), NOW));
  assert.ok(!readyForVisitor("WAITING_FOR_SELLER_RESPONSE", inHours(35.9), NOW));
  assert.ok(!readyForVisitor("WAITING_FOR_SELLER_RESPONSE", inHours(-30), NOW));
  assert.ok(!readyForVisitor("WAITING_FOR_SELLER_RESPONSE", undefined, NOW));
  assert.ok(!readyForVisitor("UNDER_REVIEW", inHours(200), NOW));
});

test("health: the refill is late after 3 hours, or when none is on record", () => {
  assert.equal(refillProblem(inHours(-2.9), NOW), null);
  assert.match(refillProblem(inHours(-3.5), NOW)!, /3\.5 hours ago/);
  assert.match(refillProblem(null, NOW)!, /No pool refill/);
});

test("health: a negative dueInHours is a problem, and pool stock inside 36 hours should have retired", () => {
  const p = deadlineProblems([
    { id: "PP-R-SFZ-1", dueInHours: -151.2, kind: "on the desk" },
    { id: "PP-R-OK-1", dueInHours: 40, kind: "on the desk" },
    { id: "PP-R-POOL-1", dueInHours: 20, kind: "pool stock" },
    { id: "PP-R-DESK-1", dueInHours: 20, kind: "on the desk" },
  ]);
  assert.equal(p.length, 2);
  assert.match(p[0], /PP-R-SFZ-1 is 151\.2 hours past PayPal's deadline/);
  assert.match(p[1], /PP-R-POOL-1 is pool stock inside 36 hours/);
});
