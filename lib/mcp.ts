import "server-only";
import { createMcpHandler } from "mcp-handler";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { deskRows } from "./desk";
import { caseView } from "./cases/view";
import { argue, fileAction } from "./cases/service";
import { claimFresh, claimReady } from "./cases/open";
import { SCENARIOS, scenario } from "./shop/scenarios";
import { CASE_ID } from "./store";
import { clientIp } from "./visitor";
import { HOUR, MINUTE, allow } from "./limits";
import { SITE_URL } from "./site";
import { reasonLabel, usd } from "./format";
import type { Brief } from "./cases/types";
import { customIdFor, preflightCart, responsibility, verifyAgentOrder, type Check } from "./agentic/mandate";
import { orderFacts } from "./agentic/review";
import { getOrder } from "./paypal/orders";
import type { CartMandate, IntentMandate, Signed } from "./agentic/types";

/**
 * Exhibit as an MCP server (Streamable HTTP at /api/mcp), so a seller's own agent can run the dispute desk:
 * list the cases, read one with its exhibits, have Exhibit argue it, and file the response or accept the
 * claim. Every action goes through the same code as the website: PayPal's HATEOAS links gate what can be
 * filed, the checker strikes what a record doesn't support, and the same per-visitor limits apply.
 * Everything is on the PayPal sandbox with test money.
 */

export const SERVER_INSTRUCTIONS = `Exhibit is a dispute desk for PayPal sellers, running on the PayPal sandbox for a demo shop, Halden Ceramics.
Use list_cases to see the disputes on the shop's sandbox account and where each stands (your move, filed, won, lost, refunded). get_case reads one case: the buyer's claim, the lettered exhibits from PayPal and the store, and what PayPal allows now. argue_case has Exhibit write the brief: a recommendation (fight or refund), the odds from a weighted tally, and the response with every sentence citing the exhibits that prove it; sentences the checker can't match to a record are struck. file_response files what the seller approves: the evidence with a Bates-stamped PDF, or an accepted claim (a full refund). Filing is real in the sandbox and can't be undone, so confirm with the user first. open_case opens a fresh sandbox dispute from one of the stories.
PayPal gives a seller ten days to answer a chargeback. Recommend refunding when the records say the seller would lose.
For buyer agents and agent platforms: preflight_cart checks a cart against a signed intent mandate before anything is signed or paid, and verify_mandate runs Exhibit's full mandate check on a signed intent and cart (and, given a PayPal order id, the order), with who is responsible. Keys are at ${SITE_URL}/.well-known/exhibit-keys.json.`;

/* AP2-style mandates, as Exhibit signs them (lib/agentic/types.ts). */
const intentMandate = z.object({
  type: z.literal("intent"),
  id: z.string(),
  cardholder: z.string(),
  agent: z.string(),
  request: z.string(),
  item: z.string(),
  quantity: z.number().int().min(1).optional(),
  maxTotal: z.string(),
  shipTo: z.string(),
  merchant: z.string(),
  issuedAt: z.string(),
  expiresAt: z.string(),
});
const cartMandate = z.object({
  type: z.literal("cart"),
  id: z.string(),
  intentId: z.string(),
  agent: z.string(),
  merchant: z.string(),
  items: z.array(z.object({ sku: z.string(), name: z.string(), quantity: z.number().int().min(1), price: z.string() })).min(1).max(20),
  shipping: z.string(),
  total: z.string(),
  shipTo: z.string(),
  signedAt: z.string(),
});
const signed = <T extends z.ZodTypeAny>(m: T) =>
  z.object({ mandate: m, alg: z.literal("EdDSA").default("EdDSA"), kid: z.string().max(80), signature: z.string().max(200), publicKey: z.string().max(200).optional() });

const checkLines = (checks: Check[]) => checks.map((c) => `- ${c.ok ? "Pass" : "Fail"}: ${c.label}. ${c.detail}.`);

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const caseLink = (id: string) => `${SITE_URL}/case/${id}`;
const idArg = z.string().regex(CASE_ID, "A PayPal case id like PP-R-ABC-10190311").describe("The PayPal dispute id, e.g. PP-R-NMS-10190311");

function briefText(id: string, b: Brief): string {
  const kept = b.sentences.filter((s) => s.kept);
  const struck = b.sentences.filter((s) => !s.kept);
  return [
    `${id}: ${b.recommendation === "accept" ? "Refund it" : "Fight it"}, ${b.odds}% chance for the seller. ${b.headline}`,
    `Response (${kept.length} sentences, each checked against the exhibits it cites):`,
    ...kept.map((s) => `- ${s.text} [${s.cites.join(", ")}]`),
    ...(struck.length ? ["Struck before filing:", ...struck.map((s) => `- ${s.text} (${s.why})`)] : []),
    "Tally:",
    ...b.tally.map((t) => `- ${t.side === "seller" ? "Seller" : "Buyer"}, weight ${t.weight}: ${t.point} [${t.cites.join(", ")}]`),
    `Engine: ${b.engine === "model" ? (b.model ?? "model") : b.engine === "rules" ? "rules engine" : "read back from PayPal"}. Case page: ${caseLink(id)}`,
  ].join("\n");
}

async function ipKey(): Promise<string> {
  return `mcp:${await clientIp().catch(() => "unknown")}`;
}

function register(server: McpServer) {
  server.registerTool(
    "preflight_cart",
    {
      title: "Check a cart against a signed intent",
      description:
        "Before signing or paying: would this cart fit the cardholder's signed intent mandate? Prices the cart from the Halden Ceramics catalogue (one parcel, so shipping is the dearest item's), checks the intent's signature against Exhibit's published keys, then the limit, the item category (a pour-over set is not a dripper), the quantity, the ship-to and the intent's validity now. Read-only.",
      inputSchema: z.object({
        intent: signed(intentMandate).describe("The signed intent mandate: { mandate, alg, kid, signature }"),
        items: z.array(z.object({ sku: z.string().max(40), quantity: z.number().int().min(1).max(10) })).min(1).max(10),
        ship_to: z.string().max(200).describe('Where the cart ships, written as the intent writes it, e.g. "2817 Lafayette Street, Denver, CO 80205"'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ intent, items, ship_to }) => {
      if (!allow("mcp-mandate", await ipKey(), 60, 10 * MINUTE)) return text("That's a lot of checks in ten minutes from one place. Try again in a few minutes.");
      const r = preflightCart(intent as Signed<IntentMandate>, items, ship_to);
      return text(
        [
          `${r.ok ? "Fits the signed intent." : "Does not fit the signed intent."} Cart: ${r.items.map((i) => `${i.quantity} × ${i.name} (${i.sku}), ${usd(i.price)}`).join("; ") || "nothing priced"}. Shipping ${usd(r.shipping)}, total ${usd(r.total)}.`,
          ...checkLines(r.checks),
        ].join("\n"),
      );
    },
  );

  server.registerTool(
    "verify_mandate",
    {
      title: "Verify an agent purchase's mandates",
      description:
        "Exhibit's full mandate check on an agent-placed purchase: the cardholder's signature on the intent and the agent platform's on the cart (each verified against the key Exhibit publishes for that kid, never a key the mandate carries), the cart against the intent, and, given the PayPal order id, the order against the cart (custom_id must be \"ap2:\" + the SHA-256 of the signed cart). Says who is responsible: the cardholder, the agent platform or the merchant. Read-only.",
      inputSchema: z.object({
        intent: signed(intentMandate).describe("The signed intent mandate: { mandate, alg, kid, signature }"),
        cart: signed(cartMandate).describe("The signed cart mandate: { mandate, alg, kid, signature }"),
        order_id: z
          .string()
          .regex(/^[A-Z0-9]{10,24}$/)
          .optional()
          .describe("The PayPal order id on the demo shop's sandbox account, to check the order against the cart"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ intent, cart, order_id }) => {
      if (!allow("mcp-mandate", await ipKey(), 60, 10 * MINUTE)) return text("That's a lot of checks in ten minutes from one place. Try again in a few minutes.");
      const c = cart as Signed<CartMandate>;
      let order = null;
      if (order_id) {
        try {
          order = orderFacts(await getOrder(order_id));
        } catch (e) {
          return text(`Couldn't read PayPal order ${order_id}: ${(e as Error).message}`);
        }
      }
      const checks = verifyAgentOrder(intent as Signed<IntentMandate>, c, order);
      const v = responsibility(checks);
      return text(
        [
          `${checks.filter((x) => x.ok).length} of ${checks.length} checks pass. Responsible: ${v.label}. ${v.line}`,
          ...checkLines(checks),
          `The PayPal order for this cart should carry custom_id ${customIdFor(c)}.`,
        ].join("\n"),
      );
    },
  );

  server.registerTool(
    "list_cases",
    {
      title: "List the disputes on the desk",
      description: "Every dispute on the demo shop's PayPal sandbox account, soonest deadline first, with where each stands (read from PayPal's own record) and Exhibit's call.",
      inputSchema: z.object({
        stage: z.enum(["waiting", "filed", "won", "lost", "refunded", "all"]).optional().describe("Only cases at this stage; 'waiting' means the seller's move. Default all."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ stage = "all" }) => {
      const rows = (await deskRows(null)).filter((r) => !r.pooled && !r.retired && r.source !== "probe");
      const shown = stage === "all" ? rows : rows.filter((r) => r.where === stage || (stage === "filed" && (r.where === "reviewing" || r.where === "open")));
      if (!shown.length) return text(`No cases at that stage. ${rows.length} cases on the desk in all.`);
      return text(
        [
          `${shown.length} case${shown.length === 1 ? "" : "s"}${stage === "all" ? "" : ` (${stage})`}:`,
          ...shown.slice(0, 40).map(
            (r) =>
              `${r.id}: ${reasonLabel(r.reason)}, ${usd(r.amount)}${r.buyer ? `, ${r.buyer}` : ""}. ${r.whereLine}.${r.recommendation ? ` Exhibit's call: ${r.recommendation === "accept" ? "refund" : "fight"}${r.odds !== null ? ` (${r.odds}%)` : ""}.` : ""}${r.due && r.where === "waiting" ? ` Respond by ${r.due.slice(0, 10)}.` : ""}`,
          ),
        ].join("\n"),
      );
    },
  );

  server.registerTool(
    "get_case",
    {
      title: "Read a case",
      description: "One dispute: the buyer's claim, every lettered exhibit (PayPal's order, payment, tracking and dispute records, and the store's scans, emails, listing and history), what was filed, where it stands, and the actions PayPal allows now.",
      inputSchema: z.object({ id: idArg }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id }) => {
      const v = await caseView(id, null);
      return text(
        [
          `${v.id}: ${reasonLabel(v.reason)}, ${usd(v.amount.value)}. ${v.whereLine}.${v.story ? ` Story: ${v.story.title}; buyer ${v.story.buyer}.` : ""}`,
          v.due && v.where === "waiting" ? `PayPal's deadline for the seller: ${v.due}.` : null,
          `PayPal allows now: ${v.actions.length ? v.actions.join(", ") : v.status === "RESOLVED" ? "nothing (PayPal has closed the case)" : "nothing yet (the case is with PayPal)"}.`,
          "Exhibits:",
          ...v.exhibits.map((e) => `[${e.id}] ${e.title} (${e.source}): ${e.facts.map((f) => `${f.label} ${f.value}`).join("; ")}${e.lines?.length ? ` | ${e.lines.join(" | ")}` : ""}`),
          v.filings.length ? "Filed:" : "Nothing filed yet.",
          ...v.filings.map((f) => `- ${f.at}: ${f.summary}${f.source === "paypal" ? " (from PayPal's record)" : ""}`),
          v.brief ? `Exhibit's call: ${v.brief.recommendation === "accept" ? "refund" : "fight"}, ${v.brief.odds}%. ${v.brief.headline}` : "Not argued yet: call argue_case.",
          `Case page: ${caseLink(v.id)}`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
  );

  server.registerTool(
    "argue_case",
    {
      title: "Argue a case",
      description: "Exhibit writes the brief for a case: fight or refund, the odds from a weighted tally, and the response to PayPal with every sentence citing the exhibits that prove it. A checker strikes any sentence whose amounts, dates, times or ids aren't in the exhibits it cites. Takes about ten seconds. Saves the brief on the case; files nothing.",
      inputSchema: z.object({ id: idArg }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ id }) => {
      const key = await ipKey();
      if (!allow("mcp-argue", key, 12, 10 * MINUTE)) return text("That's a lot of arguments in ten minutes from one place. Try again in a few minutes.");
      let brief: Brief | null = null;
      for await (const ev of argue(id, { ip: key, paced: false })) {
        if (ev.type === "error") return text(`Couldn't argue ${id}: ${ev.text}`);
        if (ev.type === "brief") brief = ev.brief;
      }
      return text(brief ? briefText(id, brief) : `Couldn't argue ${id}.`);
    },
  );

  server.registerTool(
    "file_response",
    {
      title: "File with PayPal",
      description:
        "Files the seller's choice on a case through the PayPal Disputes API (sandbox): 'evidence' sends the argued response with tracking or refund details and a Bates-stamped PDF of every exhibit; 'accept' accepts the claim and PayPal refunds the buyer in full; 'ruling' asks the sandbox simulator to rule once PayPal allows it (about 20 minutes after filing). Argue the case first. This can't be undone: confirm with the user.",
      inputSchema: z.object({
        id: idArg,
        action: z.enum(["evidence", "accept", "ruling"]),
        confirm: z.literal(true).describe("Set to true once the user has approved this filing."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ id, action }) => {
      if (!allow("mcp-file", await ipKey(), 30, 10 * MINUTE)) return text("That's a lot of filings in ten minutes from one place. Try again in a few minutes.");
      try {
        const f = await fileAction(id, action, "autopilot");
        return text(`${f.summary}. PayPal now holds it on ${id}. Case page: ${caseLink(id)}`);
      } catch (e) {
        return text(`PayPal didn't take it: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "open_case",
    {
      title: "Open a sandbox dispute",
      description: `Opens a real PayPal sandbox dispute against the demo shop from one of the stories (a card payment, a tracking number, then a chargeback from the card issuer) and returns its id. Stories: ${SCENARIOS.map((s) => `${s.id} (${s.title.replace(/[“”]/g, '"')})`).join("; ")}.`,
      inputSchema: z.object({ story: z.enum(SCENARIOS.map((s) => s.id) as [string, ...string[]]) }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ story }) => {
      const key = await ipKey();
      if (!allow("mcp-open", key, 6, HOUR)) return text("That's six cases this hour from here. Work those first.");
      const s = scenario(story)!;
      const visitor = `mcp${Math.random().toString(36).slice(2, 9)}`;
      const ready = await claimReady(s.id, visitor);
      const rec = ready ?? (await claimFresh(s, visitor));
      return text(
        ready
          ? `Opened ${rec.disputeId}: ${s.title.replace(/[“”]/g, '"')}. PayPal has handed it to the seller; argue it next. Case page: ${caseLink(rec.disputeId)}`
          : `Opened ${rec.disputeId}: ${s.title.replace(/[“”]/g, '"')}. PayPal reviews a new chargeback for five to eight minutes before the seller can answer; you can argue it now and file once it arrives. Case page: ${caseLink(rec.disputeId)}`,
      );
    },
  );
}

export const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, accept, authorization, mcp-session-id, mcp-protocol-version, last-event-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
  "access-control-max-age": "86400",
};

const inner = createMcpHandler(register, { serverInfo: { name: "Exhibit", version: "1.0.0" }, instructions: SERVER_INSTRUCTIONS });

export async function mcpHandler(req: Request): Promise<Response> {
  const res = await inner(req);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
