// Sandbox probe: checks the keys, the token scopes, a one-step card checkout, tracking, and whether
// process-chargeback opens a dispute with nothing but the merchant token.
// Usage: node scripts/probe.mjs [step]   (reads ../.env.sandbox or .env.local)
import { readFileSync, existsSync } from "node:fs";

for (const f of ["../.env.sandbox", ".env.local"]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const BASE = "https://api-m.sandbox.paypal.com";
const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) throw new Error("No PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET");

const tok = await fetch(`${BASE}/v1/oauth2/token`, {
  method: "POST",
  headers: { authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" },
  body: "grant_type=client_credentials",
}).then((r) => r.json());
if (!tok.access_token) throw new Error("token: " + JSON.stringify(tok));
const scopes = tok.scope.split(" ").map((s) => s.replace("https://uri.paypal.com/services/", ""));
console.log("app_id", tok.app_id, "\nscopes:", scopes.filter((s) => /dispute|track|reporting|vault|payments|checkout|shipping/.test(s)).join(" | "));

async function call(path, opts = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: { authorization: `Bearer ${tok.access_token}`, "content-type": "application/json", ...(opts.headers ?? {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, debug: res.headers.get("paypal-debug-id") };
}

const step = process.argv[2] ?? "all";

const disputes = await call("/v1/customer/disputes?page_size=20");
console.log("list disputes:", disputes.status, (disputes.json.items ?? []).map((d) => `${d.dispute_id} ${d.reason} ${d.status}`).join("\n  ") || JSON.stringify(disputes.json).slice(0, 300));
if (step === "list") process.exit(0);

const address = { address_line_1: "1418 Larkin Street", admin_area_2: "San Francisco", admin_area_1: "CA", postal_code: "94109", country_code: "US" };
const order = await call("/v2/checkout/orders", {
  headers: { "paypal-request-id": crypto.randomUUID(), prefer: "return=representation" },
  body: {
    intent: "CAPTURE",
    purchase_units: [{
      reference_id: "PROBE-1", invoice_id: "PROBE-" + Date.now(), description: "Probe order",
      amount: { currency_code: "USD", value: "48.00" },
      shipping: { name: { full_name: "Maya Lindqvist" }, address },
    }],
    payment_source: { card: { name: "Maya Lindqvist", number: "4012888888881881", expiry: "2030-12", security_code: "123", billing_address: address } },
  },
});
console.log("card checkout:", order.status, order.json.status, order.debug, order.status >= 300 ? JSON.stringify(order.json).slice(0, 600) : "");
const capture = order.json.purchase_units?.[0]?.payments?.captures?.[0];
console.log("capture:", capture?.id, capture?.status, JSON.stringify(capture?.network_transaction_reference ?? {}));
if (!capture) process.exit(1);

const track = await call(`/v2/checkout/orders/${order.json.id}/track`, { body: { capture_id: capture.id, tracking_number: "9400111206213859470001", carrier: "USPS", notify_payer: false } });
console.log("tracking:", track.status, track.status >= 300 ? JSON.stringify(track.json).slice(0, 400) : JSON.stringify(track.json.purchase_units?.[0]?.shipping?.trackers ?? []).slice(0, 300));

const merchantId = process.env.PAYPAL_MERCHANT_ID ?? "";
const now = new Date();
const cb = await call("/v2/customer-support/process-chargeback", {
  body: {
    adjacency: "PAYPAL", file_layout: "ATCK_CB", merchant_id: merchantId,
    financial_institution: { processor: "FDMS" },
    transaction: { id_enc: capture.id, amount: { currency_code: "USD", value: "48.00" } },
    instrument: { instrument_type: "CARD", card_brand: "VISA", credit_card_transaction_id: "2347289342893472", external: false },
    dispute: {
      id: null, stage: "CHARGEBACK", response_date: new Date(now.getTime() + 10 * 864e5).toISOString(), status: "2",
      amount: { currency_code: "USD", value: "48.00" }, receive_date: now.toISOString(), event_code: "CHARGEBACK_INITIATED",
      money_movement_date: now.toISOString(), event_type: "DEBIT", chargeback_type: "REPORTED_TO_PROCESSOR",
      processor_info: { reference_number: "31639435342702423793399", reason_code: process.argv[3] ?? "13.1", notes: "TEST_MEMO" },
    },
  },
});
console.log("process-chargeback:", cb.status, cb.debug, JSON.stringify(cb.json).slice(0, 800));
const disputeId = cb.json.dispute_id ?? cb.json.links?.find((l) => l.rel === "self")?.href.split("/").pop();
if (disputeId) {
  for (let i = 0; i < 6; i++) {
    const d = await call(`/v1/customer/disputes/${disputeId}`);
    console.log(`get ${disputeId} (try ${i}):`, d.status, d.json.reason, d.json.status, d.json.dispute_life_cycle_stage, (d.json.links ?? []).map((l) => l.rel).join(","));
    if (d.status === 200) { console.log(JSON.stringify(d.json, null, 1).slice(0, 3000)); break; }
    await new Promise((r) => setTimeout(r, 5000));
  }
}
