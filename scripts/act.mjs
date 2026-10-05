import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const BASE = "https://api-m.sandbox.paypal.com";
const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;
const tok = await fetch(`${BASE}/v1/oauth2/token`, { method: "POST", headers: { authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" }).then((r) => r.json());
const [d, verb, json] = process.argv.slice(2);
const r = await fetch(`${BASE}/v1/customer/disputes/${d}/${verb}`, { method: "POST", headers: { authorization: `Bearer ${tok.access_token}`, "content-type": "application/json" }, body: json });
console.log(verb, r.status, r.headers.get("paypal-debug-id"), (await r.text()).slice(0, 600));
const g = await fetch(`${BASE}/v1/customer/disputes/${d}`, { headers: { authorization: `Bearer ${tok.access_token}` } }).then((r) => r.json());
console.log("now:", g.status, g.dispute_state, g.seller_response_due_date ?? "", (g.links ?? []).map((l) => l.rel).join(","), JSON.stringify(g.allowed_response_options ?? {}), JSON.stringify(g.dispute_outcome ?? {}));
