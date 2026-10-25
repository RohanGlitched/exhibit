// Registers Exhibit's PayPal webhook for the three dispute events, through the REST API (no dashboard login).
// Idempotent: it lists the app's webhooks first, reuses one already pointing at the URL (adding any missing
// event types), and only creates one when none exists. Prints the webhook id and nothing else, ready for
// PAYPAL_WEBHOOK_ID.
//
//   node scripts/register-webhook.mjs [--env <path to .env.local>] [--url <webhook url>]
//
// Reads PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and optionally PAYPAL_BASE from the env file (default
// ./.env.local) or the environment. Never prints a key.
import { existsSync, readFileSync } from "node:fs";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const envFile = arg("--env") ?? ".env.local";
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

const URL_ = arg("--url") ?? "https://exhibit-desk.vercel.app/api/webhooks/paypal";
const EVENTS = ["CUSTOMER.DISPUTE.CREATED", "CUSTOMER.DISPUTE.UPDATED", "CUSTOMER.DISPUTE.RESOLVED"];
const BASE = process.env.PAYPAL_BASE || "https://api-m.sandbox.paypal.com";
const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
if (!id || !secret) fail("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are not set.");

async function call(path, init = {}) {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json", ...init.headers } });
  const text = await r.text();
  const body = text ? JSON.parse(text) : {};
  if (!r.ok) fail(`${init.method ?? "GET"} ${path}: HTTP ${r.status} ${body.name ?? ""} ${body.message ?? ""} ${body.debug_id ?? ""}`.trim());
  return body;
}

const auth = await fetch(`${BASE}/v1/oauth2/token`, {
  method: "POST",
  headers: { authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" },
  body: "grant_type=client_credentials",
});
const token = (await auth.json().catch(() => ({}))).access_token;
if (!token) fail(`PayPal refused the app keys (HTTP ${auth.status}).`);

const { webhooks = [] } = await call("/v1/notifications/webhooks");
const existing = webhooks.find((w) => w.url === URL_);
if (existing) {
  const have = new Set((existing.event_types ?? []).map((e) => e.name));
  if (!have.has("*") && EVENTS.some((e) => !have.has(e))) {
    const names = [...new Set([...have, ...EVENTS])];
    await call(`/v1/notifications/webhooks/${existing.id}`, { method: "PATCH", body: JSON.stringify([{ op: "replace", path: "/event_types", value: names.map((name) => ({ name })) }]) });
  }
  console.log(existing.id);
} else {
  const made = await call("/v1/notifications/webhooks", { method: "POST", body: JSON.stringify({ url: URL_, event_types: EVENTS.map((name) => ({ name })) }) });
  console.log(made.id);
}
