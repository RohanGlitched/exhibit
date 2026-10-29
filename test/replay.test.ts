import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { disputeIdOf, isDisputeEvent, routeFor, verificationBody, type WebhookEvent } from "../lib/webhooks/paypal.ts";

/**
 * Real signed deliveries from PayPal's sandbox, captured byte for byte by the live webhook route (the first of
 * each type, with its five transmission headers). Replayed here: the body PayPal's verify-webhook-signature call
 * receives must carry the event exactly as delivered, and the event must route to the right handler.
 */
interface Captured {
  type: string;
  headers: Record<string, string>;
  raw: string;
}
const load = (name: string): Captured | null => {
  const p = new URL(`./fixtures/${name}`, import.meta.url);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Captured) : null;
};

for (const [file, type, route] of [
  ["delivery-updated.json", "CUSTOMER.DISPUTE.UPDATED", "refresh"],
  ["delivery-resolved.json", "CUSTOMER.DISPUTE.RESOLVED", "refresh"],
] as const) {
  const d = load(file);
  test(`replayed ${type} delivery: verified byte for byte, routed to ${route}`, { skip: d ? false : `no captured ${type} delivery yet` }, () => {
    const { headers, raw } = d!;
    for (const h of ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"]) {
      assert.ok(headers[h], `captured header ${h}`);
    }
    assert.match(headers["paypal-cert-url"], /^https:\/\/api(-m)?\.sandbox\.paypal\.com\/v1\/notifications\/certs\//);
    const body = verificationBody(new Headers(headers), "WEBHOOK-ID", raw)!;
    assert.ok(body, "a verification body is built from the real headers");
    assert.ok(body.endsWith(`"webhook_event":${raw}}`), "the delivered bytes are spliced in unchanged");
    const parsed = JSON.parse(body);
    assert.equal(parsed.transmission_id, headers["paypal-transmission-id"]);
    assert.equal(parsed.webhook_id, "WEBHOOK-ID");
    const ev = JSON.parse(raw) as WebhookEvent;
    assert.equal(ev.event_type, type);
    assert.ok(isDisputeEvent(ev.event_type));
    assert.equal(routeFor(ev.event_type), route);
    assert.match(disputeIdOf(ev) ?? "", /^PP-R-[A-Z]{3}-\d+$/);
  });
}
