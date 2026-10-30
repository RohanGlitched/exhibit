import "server-only";
import { createMcpHandler } from "mcp-handler";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { deskRows } from "./desk";
import { caseView } from "./cases/view";
import { argue, fileAction } from "./cases/service";
import { claimFresh, claimReady } from "./cases/open";
import { SCENARIOS, scenario } from "./shop/scenarios";
import { CASE_ID, loadCase } from "./store";
import { publicWriteBlocked, type PublicWrite } from "./cases/locks";
import { clientIp } from "./visitor";
import { HOUR, MINUTE, allow } from "./limits";
import { SITE_URL } from "./site";
import { reasonLabel, usd } from "./format";
import type { Brief } from "./cases/types";
import { objectCase, reviewCase } from "./cases/cross";
import { transcriptText } from "./cases/hearing";
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
Use list_cases to see the disputes on the shop's sandbox account and where each stands (your move, filed, won, lost, refunded). get_case reads one case: the buyer's claim, the lettered exhibits from PayPal and the store, and what PayPal allows now. argue_case has Exhibit write the brief: a recommendation (fight or refund), the evidence balance from a weighted tally (how much of it favours the seller, not a chance of winning), and the response with every sentence citing the exhibits that prove it; sentences the checker can't match to a record are struck. file_response files what the seller approves: the evidence with a Bates-stamped PDF, or an accepted claim (a full refund). Filing is real in the sandbox and can't be undone, so confirm with the user first. cross_examine puts the case before a simulated PayPal reviewer that reads only the PDF and objects where the reason code's requirements card is weak or missing, up to four objections; Exhibit answers from the exhibits, the checker strikes answers it can't back, and the reviewer's verdict is what a later sandbox ruling request follows. Pass an objection of your own to take the reviewer's chair. open_case opens a fresh sandbox dispute from one of the stories.
Each case's seller_response_due_date (shown by get_case) is PayPal's deadline to answer; the sandbox sets ten days. Recommend refunding when the records say the seller would lose.
PayPal's own Agent Toolkit read tools ride on the same server: paypal_get_dispute, paypal_list_disputes, paypal_get_shipment_tracking and paypal_get_refund call @paypal/agent-toolkit, so one client has PayPal's tools and Exhibit's evidence layer together.
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

/** Once PayPal has decided a case, its evidence balance is not reported: the outcome is known. */
const DECIDED = new Set(["won", "lost", "refunded"]);

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const caseLink = (id: string) => `${SITE_URL}/case/${id}`;
const idArg = z.string().regex(CASE_ID, "A PayPal case id like PP-R-ABC-10190311").describe("The PayPal dispute id, e.g. PP-R-NMS-10190311");

function briefText(id: string, b: Brief): string {
  const kept = b.sentences.filter((s) => s.kept);
  const struck = b.sentences.filter((s) => !s.kept);
  return [
    `${id}: ${b.recommendation === "accept" ? "Refund it" : "Fight it"}, evidence balance ${b.odds}% for the seller (how much of the tally favours the seller, not a chance of winning). ${b.headline}`,
    `Response (${kept.length} sentences; every figure and name checked against the exhibits each cites):`,
    ...kept.map((s) => `- ${s.text} [${s.cites.join(", ")}]${s.unverified ? " (unverified: nothing in it to check)" : ""}`),
    ...(struck.length ? ["Struck before filing:", ...struck.map((s) => `- ${s.text} (${s.why})`)] : []),
    "Tally:",
    ...b.tally.map((t) => `- ${t.side === "seller" ? "Seller" : "Buyer"}, weight ${t.weight}: ${t.point} [${t.cites.join(", ")}]`),
    `Engine: ${b.engine === "model" ? (b.model ?? "model") : b.engine === "rules" ? "rules engine" : "read back from PayPal"}. Case page: ${caseLink(id)}`,
  ].join("\n");
}

/** Anonymous MCP clients get the same locks as the public site (lib/cases/guard.ts). */
async function lockedFor(id: string, what: PublicWrite): Promise<string | null> {
  return publicWriteBlocked(id, await loadCase(id).catch(() => null), what);
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
              `${r.id}: ${reasonLabel(r.reason)}, ${usd(r.amount)}${r.buyer ? `, ${r.buyer}` : ""}. ${r.whereLine}.${r.recommendation ? ` Exhibit's call: ${r.recommendation === "accept" ? "refund" : "fight"}${r.odds !== null && !DECIDED.has(r.where) ? ` (evidence balance ${r.odds}%)` : ""}.` : ""}${r.due && r.where === "waiting" ? ` Respond by ${r.due.slice(0, 10)}.` : ""}`,
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
          v.brief
            ? `Exhibit's call: ${v.brief.recommendation === "accept" ? "refund" : "fight"}${DECIDED.has(v.where) ? "" : `, evidence balance ${v.brief.odds}% for the seller`}. ${v.brief.headline}`
            : "Not argued yet: call argue_case.",
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
      description: "Exhibit writes the brief for a case: fight or refund, the evidence balance from a weighted tally, and the response to PayPal with every sentence citing the exhibits that prove it. A checker strikes any sentence whose figures or names (amounts, dates, times, ids, ZIPs, carriers, signers) aren't in the exhibits it cites, and marks sentences with nothing to check as unverified. Takes about ten seconds. Saves the brief on the case; files nothing.",
      inputSchema: z.object({ id: idArg }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ id }) => {
      const key = await ipKey();
      if (!allow("mcp-argue", key, 12, 10 * MINUTE)) return text("That's a lot of arguments in ten minutes from one place. Try again in a few minutes.");
      const locked = await lockedFor(id, "argue");
      if (locked) return text(locked);
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
      const locked = await lockedFor(id, "file");
      if (locked) return text(locked);
      try {
        // An MCP client files as the seller's own agent, on its own per-address model limit, not the autopilot's.
        const f = await fileAction(id, action, "seller", { ip: await ipKey() });
        return text(`${f.summary}. PayPal now holds it on ${id}. Case page: ${caseLink(id)}`);
      } catch (e) {
        return text(`PayPal didn't take it: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "cross_examine",
    {
      title: "Cross-examine a case",
      description:
        "Puts an argued case before a simulated PayPal dispute reviewer (a second model role) that reads only the PDF PayPal holds, or the PDF Exhibit would file, and objects where the reason code's requirements card is weak or missing, up to four objections. Exhibit answers each from the exhibits or concedes; the same checker strikes any answer whose figures aren't in the exhibits it cites; the reviewer rules and gives a verdict, which a later 'ruling' filing follows. On an unfiled draft, concessions withdraw sentences or change the call to refund. With `objection`, you take the reviewer's chair instead: Exhibit answers your objection, checked, and nothing is saved. Takes up to a minute.",
      inputSchema: z.object({
        id: idArg,
        objection: z.string().min(8).max(300).optional().describe("Your own objection to the response. Leave out to run the full hearing."),
        sentence: z.number().int().min(1).max(20).optional().describe("The response sentence your objection is about (1-based). Leave out for the response as a whole."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ id, objection, sentence }) => {
      const key = await ipKey();
      if (!allow("mcp-review", key, 6, 10 * MINUTE)) return text("That's a lot of hearings in ten minutes from one place. Try again in a few minutes.");
      try {
        if (objection) {
          const x = await objectCase(id, objection, sentence ? sentence - 1 : null, key);
          return text(
            [
              `OBJECTION: ${x.objection.text}`,
              x.answer.stance === "concede" ? `A. (concedes) ${x.answer.text}` : `A. ${x.answer.text} [${x.answer.cites.join(", ")}]${x.answer.kept ? " (checked: every figure is in the exhibits cited)" : ` (struck by the checker: ${x.answer.why})`}`,
              `${x.ruling.toUpperCase()}. ${x.reason}.`,
              "Nothing was saved or filed.",
            ].join("\n"),
          );
        }
        const locked = await lockedFor(id, "hearing");
        if (locked) return text(locked);
        const { hearing } = await reviewCase(id, key);
        return text(`${transcriptText(hearing)}\nCase page: ${caseLink(id)}`);
      } catch (e) {
        return text(`Couldn't cross-examine ${id}: ${(e as Error).message}`);
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

/**
 * PayPal's own Agent Toolkit tools, passed through on the same server (lib/paypal/toolkit.ts): the read side of
 * PayPal's agent stack next to Exhibit's evidence layer. Read-only, on this demo shop's sandbox account.
 */
const TOOLKIT_PASS = [
  { name: "paypal_get_dispute", tool: "get_dispute", title: "PayPal: read a dispute (Agent Toolkit)", description: "PayPal's own get_dispute tool from @paypal/agent-toolkit: the dispute exactly as PayPal returns it.", schema: z.object({ dispute_id: z.string().regex(CASE_ID) }) },
  { name: "paypal_list_disputes", tool: "list_disputes", title: "PayPal: list disputes (Agent Toolkit)", description: "PayPal's own list_disputes tool from @paypal/agent-toolkit, newest first.", schema: z.object({ page_size: z.number().int().min(1).max(20).optional() }) },
  { name: "paypal_get_shipment_tracking", tool: "get_shipment_tracking", title: "PayPal: tracking for a payment (Agent Toolkit)", description: "PayPal's own get_shipment_tracking tool from @paypal/agent-toolkit: the trackers PayPal holds for a payment (a dispute's seller_transaction_id).", schema: z.object({ transaction_id: z.string().regex(/^[A-Za-z0-9_-]{12,40}$/) }) },
  { name: "paypal_get_refund", tool: "get_refund", title: "PayPal: read a refund (Agent Toolkit)", description: "PayPal's own get_refund tool from @paypal/agent-toolkit: a refund and the capture it credited.", schema: z.object({ refund_id: z.string().regex(/^[A-Za-z0-9_-]{15,32}$/) }) },
] as const;

function registerPayPalToolkit(server: McpServer) {
  // The one toolkit write on MCP: PayPal's accept_dispute_claim, guarded like file_response (PayPal's links, the
  // per-address limit, an explicit confirm), and recorded on the case.
  server.registerTool(
    "paypal_accept_dispute_claim",
    {
      title: "PayPal: accept a claim and refund (Agent Toolkit)",
      description:
        "Accepts the claim on a sandbox case through PayPal's own Agent Toolkit accept_dispute_claim: PayPal refunds the buyer in full and the case closes. Real in the sandbox and can't be undone, so pass confirm: true only after the user agrees. Exhibit argues the case first if it hasn't.",
      inputSchema: z.object({ id: z.string().regex(CASE_ID), confirm: z.literal(true) }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ id }) => {
      if (!allow("mcp-file", await ipKey(), 10, 10 * MINUTE)) return text("That's a lot of filings from one place. Try again in a few minutes.");
      const locked = await lockedFor(id, "file");
      if (locked) return text(locked);
      try {
        const f = await fileAction(id, "accept", "seller", { ip: await ipKey(), viaToolkit: true });
        return text(`${id}: ${f.summary}. Case page: ${caseLink(id)}`);
      } catch (e) {
        return text(`Couldn't accept ${id}: ${(e as Error).message}`);
      }
    },
  );

  for (const t of TOOLKIT_PASS) {
    server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.schema, annotations: { readOnlyHint: true, openWorldHint: true } }, async (args: Record<string, unknown>) => {
      if (!allow("mcp-toolkit", await ipKey(), 60, 10 * MINUTE)) return text("That's a lot of PayPal reads in ten minutes from one place. Try again in a few minutes.");
      try {
        const { toolkitCall } = await import("./paypal/toolkit");
        const a = t.tool === "list_disputes" ? { page_size: (args.page_size as number | undefined) ?? 10 } : args;
        return text(JSON.stringify(await toolkitCall(t.tool, a)).slice(0, 12_000));
      } catch (e) {
        return text(`PayPal's Agent Toolkit couldn't answer ${t.tool}: ${(e as Error).message}`);
      }
    });
  }
}

export const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, accept, authorization, mcp-session-id, mcp-protocol-version, last-event-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
  "access-control-max-age": "86400",
};

const inner = createMcpHandler((server) => {
  register(server);
  registerPayPalToolkit(server);
}, { serverInfo: { name: "Exhibit", version: "1.0.0" }, instructions: SERVER_INSTRUCTIONS });

export async function mcpHandler(req: Request): Promise<Response> {
  const res = await inner(req);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
