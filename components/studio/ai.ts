import { createAiHarness, directLlmRunner, type AgAiHarnessSetup, type AgAiPromptStarter, type AgAiTool, type AgStudioApi } from "ag-studio";
import { openaiAdapter } from "./adapter";
import type { AnalyticsPayload } from "./data";
import { PAGES } from "./report";

/**
 * The analyst behind the analytics page, on Studio's agent framework.
 *
 * "Exhibit analyst" fronts every conversation. It knows the dispute domain (PayPal's ten-day window, fight
 * or refund, the checker), reads the desk through two tools of its own, turns the report to the page that
 * answers a question, and uses Studio's built-in tools to read the schema, the report and run queries.
 * Anything that changes the dashboard it hands to Studio's own planning, page and widget agents through
 * delegate_to, so Studio's agents place and configure the widgets, Exhibit's custom ones included.
 *
 * Every agent runs on Studio's direct LLM runner. Its adapter posts each turn to /api/studio-agent, which
 * calls the app's GPT-5.6 deployment on Azure OpenAI; no key or model reaches the browser.
 */

const PROMPTS: AgAiPromptStarter[] = [
  { label: "What will cost me money this week?", prompt: "Which cases will cost me money this week?" },
  { label: "Compare kept and refunded", prompt: "Add a widget comparing what we kept by fighting with what we refunded." },
  { label: "Where does the checker strike?", prompt: "Where does the checker strike most?" },
];

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);

function instructions(api: AgStudioApi, read: () => AnalyticsPayload | null): string {
  const data = read();
  const { tables } = api.getAiContext().schema();
  const page = api.getState().selectedPageId;
  const desk = data
    ? `The desk now holds ${data.cases.length} cases and ${data.sentences.length} checked brief sentences (read ${data.at}).`
    : "The desk's data is still loading.";
  return `You are Exhibit analyst, the analyst on Exhibit's dispute desk for a small PayPal seller (Halden Ceramics, on PayPal's sandbox). You answer questions about the seller's disputes and change this AG Studio dashboard when asked.

How disputes work here:
- A buyer opens a dispute with PayPal (not received, not as described, unauthorised). The seller has PayPal's ten-day window to answer; a case with no answer by the deadline is lost by default. "Your move" means PayPal is waiting on the seller; cases.daysLeft counts the days left and is blank otherwise. Two days or fewer is urgent.
- Exhibit recommends a call per case: Fight (file evidence; cases.odds is the seller's chance in percent) or Refund (accept the claim and return the money). "Not argued" means nobody has asked Exhibit yet.
- Money: each case's amount sits in exactly one of kept (won by fighting), refunded (accepted), lostAmount (lost) or atStake (undecided). All USD.
- Exhibit writes each response so every sentence cites a PayPal record. Its checker strikes any sentence without one; the sentences table holds each sentence's verdict (Kept or Struck) and why.

${desk}
Tables: ${tables.map((t) => `${t.name} (${t.fields.map((f) => f.name).join(", ")})`).join("; ")}.
The report's pages: ${PAGES.map((p) => `${p.id} ("${p.title}": ${p.note})`).join("; ")}. The reader is on "${page}".

How to work:
- For deadlines and what will cost money soon, call deadline_ladder. For the money picture, call desk_ledger. For anything else, call view_schema once, then execute_query. Never guess numbers.
- When an answer lives on another page, call turn_to_page so the reader sees it.
- To add, change, move or remove widgets, delegate: to "page" to add or position widgets, then to "widget" (with the widget's type and id) to configure each one; use "planning" first for anything that needs three or more widgets. Prefer Exhibit's own widget types where they fit: exhibit-ledger (kept, refunded, lost, at stake), exhibit-deadline-ladder (cases on the seller's move), exhibit-checker-strikes (the checker's verdicts), exhibit-stamps (counts by outcome or stage). Put new widgets in free space below what is there.
- After a change, say in one line what you added and where.

How to answer: plain words, short. Lead with the answer, then at most five short lines. Name cases by their id (PP-...) and give money in dollars. Say "the seller" or "you", never "the user". No tables in replies. If the data can't answer the question, say so.`;
}

export function exhibitAi(read: () => AnalyticsPayload | null): AgAiHarnessSetup {
  const adapter = openaiAdapter({ endpoint: "/api/studio-agent" });

  return ({ api }) =>
    createAiHarness(api, ({ builtIn, tools }) => {
      const { studio } = tools;

      const deadlineLadder: AgAiTool = api.defineAiTool({
        name: "deadline_ladder",
        description:
          "The cases on the seller's move, soonest PayPal deadline first: case id, days left, amount, the buyer's story, Exhibit's call and odds. Reads the whole desk, ignoring dashboard filters.",
        params: (s) => s.object({ withinDays: s.number({ description: "Only cases due within this many days. Omit for all." }).optional() }),
        execute: (args: { withinDays?: number }, ctx) => {
          const data = read();
          if (!data) return ctx.error("The desk's data hasn't loaded yet. Try again in a moment.");
          const rungs = data.cases
            .filter((c) => c.daysLeft != null && (args.withinDays == null || (c.daysLeft ?? 0) <= args.withinDays))
            .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0) || b.amount - a.amount);
          if (rungs.length === 0) return ctx.success(args.withinDays != null ? `No case is due within ${args.withinDays} days.` : "No case is on the seller's move.");
          const lines = rungs.map(
            (c) =>
              `${c.caseId}: ${c.daysLeft} day${c.daysLeft === 1 ? "" : "s"} left, ${usd(c.amount)}, "${c.story}", buyer ${c.buyer || "unknown"}, call ${c.call}${c.odds != null ? ` (${c.odds}% to win)` : ""}`,
          );
          const total = rungs.reduce((s, c) => s + c.amount, 0);
          return ctx.success(`${rungs.length} cases on the seller's move, ${usd(total)} in all:\n${lines.join("\n")}`, { cases: rungs.map((c) => c.caseId) });
        },
      });

      const deskLedger: AgAiTool = api.defineAiTool({
        name: "desk_ledger",
        description: "The money on the whole desk: kept by fighting, refunded, lost and still at stake, with case counts by where cases stand and by Exhibit's call.",
        params: (s) => s.object({}),
        execute: (_args: Record<string, never>, ctx) => {
          const data = read();
          if (!data) return ctx.error("The desk's data hasn't loaded yet. Try again in a moment.");
          const total = (k: "kept" | "refunded" | "lostAmount" | "atStake") => data.cases.reduce((s, c) => s + c[k], 0);
          const count = (k: "stage" | "call") =>
            Object.entries(data.cases.reduce<Record<string, number>>((m, c) => ((m[c[k]] = (m[c[k]] ?? 0) + 1), m), {}))
              .map(([v, n]) => `${v} ${n}`)
              .join(", ");
          return ctx.success(
            `Kept by fighting ${usd(total("kept"))}; refunded ${usd(total("refunded"))}; lost ${usd(total("lostAmount"))}; still at stake ${usd(total("atStake"))}. ` +
              `Cases by where they stand: ${count("stage")}. By Exhibit's call: ${count("call")}.`,
          );
        },
      });

      const turnToPage: AgAiTool = api.defineAiTool({
        name: "turn_to_page",
        description: "Show the reader one of the report's pages.",
        params: (s) => s.object({ page: s.enum(PAGES.map((p) => p.id)) }),
        execute: (args: { page: string }, ctx) => {
          api.setState({ ...api.getState(), selectedPageId: args.page });
          return ctx.success(`Now showing the ${PAGES.find((p) => p.id === args.page)?.title ?? args.page} page.`);
        },
      });

      const analyst = directLlmRunner({
        id: "exhibit-analyst",
        name: "Exhibit analyst",
        description: "Answers questions about the seller's PayPal disputes and changes the dashboard through Studio's agents.",
        schema: (s) => s.undefined(),
        adapter,
        maxTurns: 24,
        instructions: () => instructions(api, read),
        tools: () => [
          deadlineLadder,
          deskLedger,
          turnToPage,
          studio.viewSchema(),
          studio.viewReport(),
          studio.viewPage(),
          studio.executeQuery(),
          tools.plan.view(),
          tools.plan.update(),
          tools.renameThread(),
          tools.delegateTo(["planning", "data", "page", "widget"]),
        ],
      });

      // Studio's own specialists, unchanged, as the analyst's delegates on the same model.
      const team = (["planning", "data", "page", "widget"] as const).map((id) => directLlmRunner({ ...builtIn[id], adapter }));

      return { agents: [analyst, ...team], primary: "exhibit-analyst", promptStarters: PROMPTS };
    });
}
