import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// /proof's Agent Toolkit table must not call a tool "Not used" while lib/paypal/toolkit.ts calls it.
test("/proof lists no Agent Toolkit tool as unused that the code calls", () => {
  const code = readFileSync(new URL("../lib/paypal/toolkit.ts", import.meta.url), "utf8");
  const called = new Set([...code.matchAll(/toolkitCall(?:<[^>]*>)?\(\s*"([a-z_]+)"/g)].map((m) => m[1]));
  const listed = code.match(/TOOLKIT_TOOLS = \[([^\]]+)\]/)?.[1] ?? "";
  for (const m of listed.matchAll(/"([a-z_]+)"/g)) called.add(m[1]);
  assert.ok(called.has("accept_dispute_claim") && called.has("create_shipment_tracking"), "the toolkit's two writes are called");
  const page = readFileSync(new URL("../app/proof/page.tsx", import.meta.url), "utf8");
  const rows = [...page.matchAll(/<th scope="row">([^<]+)<\/th>\s*<td>\s*([\s\S]*?)<\/td>/g)];
  const unused = rows.filter((r) => /^Not used/.test(r[2].trim())).flatMap((r) => r[1].split(",").map((t) => t.trim()));
  for (const t of unused) assert.ok(!called.has(t), `/proof says ${t} is not used, but lib/paypal/toolkit.ts calls it`);
  for (const t of ["accept_dispute_claim", "create_shipment_tracking"]) assert.ok(rows.some((r) => r[1].includes(t)), `/proof has a row for ${t}`);
});
