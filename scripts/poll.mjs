import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const BASE = "https://api-m.sandbox.paypal.com";
const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;
const tok = await fetch(`${BASE}/v1/oauth2/token`, { method: "POST", headers: { authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" }).then((r) => r.json());
const ids = process.argv.slice(2);
const t0 = Date.now();
for (let i = 0; i < 1; i++) {
  for (const d of ids) {
    const r = await fetch(`${BASE}/v1/customer/disputes/${d}`, { headers: { authorization: `Bearer ${tok.access_token}` } }).then((r) => r.json());
    console.log(Math.round((Date.now() - t0) / 1000) + "s", d, r.reason, r.status, r.dispute_state, r.seller_response_due_date ?? "", (r.links ?? []).map((l) => l.rel).join(","), JSON.stringify(r.allowed_response_options ?? {}));
  }
  await new Promise((r) => setTimeout(r, 30000));
}
