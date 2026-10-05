// One-off repair: records a filing PayPal accepted but Exhibit failed to save. Usage: node scripts/fix-filing.mjs <id> <summary>
import { readFileSync } from "node:fs";
import { get, put } from "@vercel/blob";
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const [id, summary] = process.argv.slice(2);
const r = await get(`cases/${id}.json`, { access: "private", useCache: false });
const rec = JSON.parse(await new Response(r.stream).text());
if (!rec.filings.length) rec.filings.push({ at: new Date().toISOString(), action: "evidence", ok: true, by: "seller", summary });
await put(`cases/${id}.json`, JSON.stringify(rec), { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });
console.log(id, rec.filings);
