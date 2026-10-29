// One MCP client, two servers: PayPal's own MCP server (@paypal/mcp, over stdio, on the sandbox) and Exhibit's
// (Streamable HTTP at /api/mcp). Reads a case through PayPal's tools, then through Exhibit's evidence layer, and
// writes the session to docs/mcp-session.txt. Nothing is filed. With --argue <id>, Exhibit also argues that case
// (one model call; the brief is saved on the case, nothing is sent to PayPal).
//
//   node scripts/mcp-session.mjs [case id] [--argue <case id>]     (reads .env.local when the variables aren't set)
//
// Needs PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox) for PayPal's server; the access token it gets is
// handed to the child process and never printed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const EXHIBIT = process.env.EXHIBIT_MCP ?? "https://exhibit-desk.vercel.app/api/mcp";
const SANDBOX = "https://api-m.sandbox.paypal.com";
const lines = [];
const log = (s = "") => {
  lines.push(s);
  console.log(s);
};
const clip = (s, n = 600) => (s.length > n ? `${s.slice(0, n)} …` : s);
const textOf = (r) => (r.content ?? []).map((c) => c.text ?? "").join("\n");

if (!process.env.PAYPAL_CLIENT_ID && existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) throw new Error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox), or put them in .env.local.");
const tok = await fetch(`${SANDBOX}/v1/oauth2/token`, {
  method: "POST",
  headers: { authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" },
  body: "grant_type=client_credentials",
}).then((r) => r.json());

const paypal = new Client({ name: "seller-agent", version: "1.0.0" });
const exhibit = new Client({ name: "seller-agent", version: "1.0.0" });
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
await paypal.connect(
  new StdioClientTransport({
    command: npx,
    args: ["-y", "@paypal/mcp@1.8.1", "--tools=all"],
    env: { ...process.env, PAYPAL_ACCESS_TOKEN: tok.access_token, PAYPAL_ENVIRONMENT: "SANDBOX" },
    stderr: "ignore",
  }),
);
await exhibit.connect(new StreamableHTTPClientTransport(new URL(EXHIBIT)));

const started = new Date().toISOString();
log(`MCP session, ${started}`);
log(`Client: one seller agent. Servers: PayPal MCP (@paypal/mcp 1.8.1, stdio, SANDBOX) and Exhibit (${EXHIBIT}).`);
const pt = (await paypal.listTools()).tools;
const et = (await exhibit.listTools()).tools;
log(`PayPal MCP offers ${pt.length} tools, among them ${pt.map((t) => t.name).filter((n) => /dispute|track|refund/.test(n)).join(", ")}.`);
log(`Exhibit offers ${et.length} tools: ${et.map((t) => t.name).join(", ")}.`);

async function call(client, server, name, args) {
  log("");
  log(`→ ${server}.${name} ${JSON.stringify(args)}`);
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: args });
  const out = textOf(r);
  log(`← ${Date.now() - t0} ms`);
  log(clip(out));
  return out;
}

const listed = await call(paypal, "paypal", "list_disputes", { page_size: 5 });
const argv = process.argv.slice(2);
const ai = argv.indexOf("--argue");
const argueId = ai >= 0 ? argv[ai + 1] : null;
let caseId = argv.find((a, i) => !a.startsWith("--") && (ai < 0 || i !== ai + 1));
if (!caseId) {
  try {
    caseId = JSON.parse(listed).items?.[0]?.dispute_id;
  } catch {
    caseId = listed.match(/PP-R-[A-Z]{3}-\d+/)?.[0];
  }
}
if (!caseId) throw new Error("No dispute to read.");
const raw = await call(paypal, "paypal", "get_dispute", { dispute_id: caseId });
let tx = null;
try {
  tx = JSON.parse(raw).disputed_transactions?.[0]?.seller_transaction_id ?? null;
} catch {
  tx = raw.match(/"seller_transaction_id":"([A-Z0-9]+)"/)?.[1] ?? null;
}
await call(exhibit, "exhibit", "get_case", { id: caseId });
if (tx) await call(exhibit, "exhibit", "paypal_get_shipment_tracking", { transaction_id: tx });
await call(exhibit, "exhibit", "list_cases", { stage: "waiting" });
if (argueId) await call(exhibit, "exhibit", "argue_case", { id: argueId });

await paypal.close();
await exhibit.close();
log("");
log("PayPal's server answers what PayPal holds; Exhibit's answers what it proves: the lettered exhibits, the brief with every sentence checked, the hearing, and what may be filed now.");
writeFileSync(new URL("../docs/mcp-session.txt", import.meta.url), lines.join("\n") + "\n");
