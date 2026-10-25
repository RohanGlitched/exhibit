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

/**
 * Exhibit as an MCP server (Streamable HTTP at /api/mcp), so a seller's own agent can run the dispute desk:
 * list the cases, read one with its exhibits, have Exhibit argue it, and file the response or accept the
 * claim. Every action goes through the same code as the website: PayPal's HATEOAS links gate what can be
 * filed, the checker strikes what a record doesn't support, and the same per-visitor limits apply.
 * Everything is on the PayPal sandbox with test money.
 */

export const SERVER_INSTRUCTIONS = `Exhibit is a dispute desk for PayPal sellers, running on the PayPal sandbox for a demo shop, Halden Ceramics.
Use list_cases to see the disputes on the shop's sandbox account and where each stands (your move, filed, won, lost, refunded). get_case reads one case: the buyer's claim, the lettered exhibits from PayPal and the store, and what PayPal allows now. argue_case has Exhibit write the brief: a recommendation (fight or refund), the odds from a weighted tally, and the response with every sentence citing the exhibits that prove it; sentences the checker can't match to a record are struck. file_response files what the seller approves: the evidence with a Bates-stamped PDF, or an accepted claim (a full refund). Filing is real in the sandbox and can't be undone, so confirm with the user first. open_case opens a fresh sandbox dispute from one of the stories.
PayPal gives a seller ten days to answer a chargeback. Recommend refunding when the records say the seller would lose.`;

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const caseLink = (id: string) => `${SITE_URL}/case/${id}`;
const idArg = z.string().regex(CASE_ID, "A PayPal case id like PP-R-ABC-10190311").describe("The PayPal dispute id, e.g. PP-R-NMS-10190311");

function briefText(id: string, b: Brief): string {
  const kept = b.sentences.filter((s) => s.kept);
  const struck = b.sentences.filter((s) => !s.kept);
  return [
    `${id}: ${b.recommendation === "accept" ? "Refund it" : "Fight it"}, ${b.odds}% chance for the seller. ${b.headline}`,
    `Response (${kept.length} sentences; every figure and name checked against the exhibits each cites):`,
    ...kept.map((s) => `- ${s.text} [${s.cites.join(", ")}]${s.unverified ? " (unverified: nothing in it to check)" : ""}`),
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
      description: "Exhibit writes the brief for a case: fight or refund, the odds from a weighted tally, and the response to PayPal with every sentence citing the exhibits that prove it. A checker strikes any sentence whose figures or names (amounts, dates, times, ids, ZIPs, carriers, signers) aren't in the exhibits it cites, and marks sentences with nothing to check as unverified. Takes about ten seconds. Saves the brief on the case; files nothing.",
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
