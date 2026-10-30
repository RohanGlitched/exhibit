import { createAiHarness, directLlmRunner, type AgAiHarnessSetup, type AgAiPromptStarter, type AgAiTool, type AgWidgetLayoutState } from "ag-studio";
import { openaiAdapter } from "./adapter";
import { ANALYST_ID, ANALYST_TOOLS, type AnalystContext } from "./analyst";
import type { AnalyticsPayload } from "./data";
import { LADDER_THREAD_ID, seededHistory } from "./history";
import { LADDER_THREAD } from "./saved-ladder";
import { PAGES, type PageId } from "./pages";
import { knownCases, ladderCrossFilter, ladderSelection, replayIds } from "./ladder-filter";

/**
 * The analyst behind the analytics page, on Studio's agent framework.
 *
 * "Exhibit analyst" fronts every conversation. It knows the dispute domain (PayPal's ten-day window, fight
 * or refund, the checker), reads the desk through tools of its own, turns the report to the page that
 * answers a question, and uses Studio's built-in tools to read the schema, the report and run queries.
 * Anything that changes the dashboard it hands to Studio's own planning, page and widget agents through
 * delegate_to, after taking a fresh widget id and free space from new_widget_slot; check_widget then reads
 * the report back so the reply says only what really changed.
 *
 * Every agent runs on Studio's direct LLM runner. Its adapter posts each turn to /api/studio-agent, which
 * builds the analyst's instructions and tool list on the server and calls the app's model (GPT-5.6 on Azure, or Claude Haiku 4.5 on Amazon
 * Bedrock); no key or model reaches the browser.
 */

const PROMPTS: AgAiPromptStarter[] = [
  { label: "What will cost me money this week?", prompt: "Which cases will cost me money this week?" },
  { label: "Add a ledger for unauthorised cases", prompt: "Add a ledger of kept, refunded and lost money for unauthorised cases only, on the Money page." },
  { label: "Where does the checker strike?", prompt: "Where does the checker strike most?" },
];

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);

type Snapshot = Record<string, string>;
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "widget";

export function exhibitAi(read: () => AnalyticsPayload | null): AgAiHarnessSetup {
  return ({ api }) =>
    createAiHarness(api, ({ builtIn, tools }) => {
      const { studio } = tools;
      const pageState = (id: string) => api.getState().pages.find((p) => p.id === id);
      const widgetIds = () => new Set(api.getState().pages.flatMap((p) => Object.keys(p.widgets ?? {})));
      // Each page's widgets as they stood when the analyst last asked for a slot, to catch an overwrite.
      const before = new Map<string, Snapshot>();
      const snapshot = (id: string): Snapshot =>
        Object.fromEntries(Object.entries(pageState(id)?.widgets ?? {}).map(([wid, w]) => [wid, JSON.stringify({ type: w?.type, format: w?.format, dataMapping: w?.dataMapping })]));

      const context = (): AnalystContext | null => {
        const data = read();
        const page = api.getState().selectedPageId;
        if (!data) return null;
        return { page: (PAGES.some((p) => p.id === page) ? page : "deadlines") as PageId, cases: data.cases.length, sentences: data.sentences.length, at: data.at };
      };
      const analystAdapter = openaiAdapter({ endpoint: "/api/studio-agent", agent: ANALYST_ID, context });

      const deadlineLadder: AgAiTool = api.defineAiTool({
        name: ANALYST_TOOLS.deadline_ladder.name,
        description: ANALYST_TOOLS.deadline_ladder.description,
        params: (s) => s.object({ withinDays: s.number({ description: "Only cases due within this many days. Omit for all." }).optional() }),
        execute: (args: { withinDays?: number }, ctx) => {
          const data = read();
          if (!data) return ctx.error("The desk's data hasn't loaded yet. Try again in a moment.");
          const clocked = data.cases.filter((c) => c.daysLeft != null);
          const missed = clocked.filter((c) => (c.daysLeft ?? 0) < 0).sort((a, b) => (b.daysLeft ?? 0) - (a.daysLeft ?? 0));
          const rungs = clocked
            .filter((c) => (c.daysLeft ?? 0) >= 0 && (args.withinDays == null || (c.daysLeft ?? 0) <= args.withinDays))
            .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0) || b.amount - a.amount);
          const line = (c: (typeof clocked)[number]) =>
            `${c.caseId}: ${c.daysLeft === 0 ? "due today" : `${c.daysLeft} day${c.daysLeft === 1 ? "" : "s"} left`}, ${usd(c.amount)}, "${c.story}", buyer ${c.buyer || "unknown"}, call ${c.call}${c.odds != null ? ` (evidence balance ${c.odds}%)` : ""}`;
          const live = rungs.length
            ? `${rungs.length} cases on the seller's move${args.withinDays != null ? ` due within ${args.withinDays} days` : ""}, ${usd(rungs.reduce((s, c) => s + c.amount, 0))} in all:\n${rungs.map(line).join("\n")}`
            : args.withinDays != null
              ? `No live case is due within ${args.withinDays} days.`
              : "No case is inside PayPal's window on the seller's move.";
          const gone = missed.length
            ? `\nMissed (the deadline passed with no answer; not the seller's move any more): ${missed
                .map((c) => `${c.caseId} missed ${-(c.daysLeft ?? 0)} days ago, ${usd(c.amount)}`)
                .join("; ")}.`
            : "";
          return ctx.success(live + gone, { cases: rungs.map((c) => c.caseId), missed: missed.map((c) => c.caseId) });
        },
      });

      const deskLedger: AgAiTool = api.defineAiTool({
        name: ANALYST_TOOLS.desk_ledger.name,
        description: ANALYST_TOOLS.desk_ledger.description,
        params: (s) => s.object({}),
        execute: (_args: Record<string, never>, ctx) => {
          const data = read();
          if (!data) return ctx.error("The desk's data hasn't loaded yet. Try again in a moment.");
          const total = (k: "kept" | "keptAsked" | "keptByItself" | "refunded" | "lostAmount" | "atStake") => data.cases.reduce((s, c) => s + c[k], 0);
          const count = (k: "stage" | "call") =>
            Object.entries(data.cases.reduce<Record<string, number>>((m, c) => ((m[c[k]] = (m[c[k]] ?? 0) + 1), m), {}))
              .map(([v, n]) => `${v} ${n}`)
              .join(", ");
          return ctx.success(
            `Kept by fighting ${usd(total("kept"))} (${usd(total("keptAsked"))} ruled at Exhibit's request, ${usd(total("keptByItself"))} closed by the sandbox on its own); refunded ${usd(total("refunded"))}; lost ${usd(total("lostAmount"))}; still at stake ${usd(total("atStake"))}. ` +
              `Cases by where they stand: ${count("stage")}. By Exhibit's call: ${count("call")}.`,
          );
        },
      });

      const turnToPage: AgAiTool = api.defineAiTool({
        name: ANALYST_TOOLS.turn_to_page.name,
        description: ANALYST_TOOLS.turn_to_page.description,
        params: (s) => s.object({ page: s.enum(PAGES.map((p) => p.id)) }),
        execute: (args: { page: string }, ctx) => {
          api.setState({ ...api.getState(), selectedPageId: args.page });
          return ctx.success(`Now showing the ${PAGES.find((p) => p.id === args.page)?.title ?? args.page} page.`);
        },
      });

      const filterLadder: AgAiTool = api.defineAiTool({
        name: ANALYST_TOOLS.filter_ladder.name,
        description: ANALYST_TOOLS.filter_ladder.description,
        params: (s) => s.object({ caseIds: s.array(s.string(), { description: "Case ids (PP-...) to keep, from deadline_ladder. Empty clears the filter." }) }),
        execute: (args: { caseIds: string[] }, ctx) => {
          const data = read();
          if (!data) return ctx.error("The desk's data hasn't loaded yet. Try again in a moment.");
          const { kept, unknown } = knownCases(args.caseIds ?? [], data.cases);
          if (args.caseIds?.length && !kept.length) return ctx.error(`None of ${unknown.join(", ")} is on the desk; nothing was filtered.`);
          const state = api.getState();
          const pages = state.pages.map((p) => (p.id === "deadlines" ? { ...p, crossFilter: ladderCrossFilter(p.crossFilter, kept) } : p));
          api.setState({ ...state, pages, selectedPageId: "deadlines" });
          // Read the page back: report only the selection Studio now holds.
          const now = ladderSelection(api.getState().pages.find((p) => p.id === "deadlines")?.crossFilter);
          if (!kept.length) return ctx.success(now.length ? `The ladder still holds a filter on ${now.join(", ")}.` : "Cleared the ladder's filter: the Deadlines page shows every case again.");
          const rows = data.cases.filter((c) => now.includes(c.caseId));
          const money = rows.reduce((n, c) => n + c.amount, 0);
          return ctx.success(
            now.length
              ? `The Deadlines page is cross-filtered from the ladder to ${now.join(", ")} (${usd(money)} between them): the ladder, the stamps, the chart and the case list show only these.${unknown.length ? ` Not on the desk, left out: ${unknown.join(", ")}.` : ""}`
              : "Studio didn't take the filter; the page still shows every case. Say so.",
            { kept: now, unknown },
          );
        },
      });

      const openCaseTool: AgAiTool = api.defineAiTool({
        name: ANALYST_TOOLS.open_case.name,
        description: ANALYST_TOOLS.open_case.description,
        params: (s) => s.object({ caseId: s.string({ description: "The case id, PP-..." }) }),
        execute: (args: { caseId: string }, ctx) => {
          const data = read();
          if (!data) return ctx.error("The desk's data hasn't loaded yet. Try again in a moment.");
          const { kept } = knownCases([args.caseId], data.cases);
          if (!kept.length) return ctx.error(`${args.caseId} isn't on the desk; nothing was opened.`);
          const id = kept[0];
          const url = `/case/${encodeURIComponent(id)}`;
          // A new tab, so the conversation stays where it is; a browser that blocks it gets the address instead.
          const tab = window.open(url, "_blank");
          if (tab) tab.opener = null;
          return tab
            ? ctx.success(`Opened ${id} in a new tab (${url}).`, { caseId: id, url, opened: true })
            : ctx.success(`The browser didn't open a new tab. ${id} is at ${url}; give the reader that link.`, { caseId: id, url, opened: false });
        },
      });

      const newWidgetSlot: AgAiTool = api.defineAiTool({
        name: ANALYST_TOOLS.new_widget_slot.name,
        description: ANALYST_TOOLS.new_widget_slot.description,
        params: (s) =>
          s.object({
            page: s.enum(PAGES.map((p) => p.id)),
            name: s.string({ description: "Two to four words naming the widget, e.g. 'kept vs refunded'." }),
            xSpan: s.number({ description: "Width in tracks out of 24. Default 24." }).optional(),
            ySpan: s.number({ description: "Height in 18 px rows. Default 16." }).optional(),
          }),
        execute: (args: { page: string; name: string; xSpan?: number; ySpan?: number }, ctx) => {
          const page = pageState(args.page);
          if (!page) return ctx.error(`There is no page "${args.page}".`);
          const taken = widgetIds();
          const base = `added-${slug(args.name)}`;
          let id = base;
          for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
          const bottom = Object.values(page.widgetLayout ?? {}).reduce((m, l) => (l ? Math.max(m, l.yTrack + l.ySpan) : m), 0);
          const xSpan = Math.max(6, Math.min(24, Math.round(args.xSpan ?? 24)));
          const ySpan = Math.max(8, Math.min(30, Math.round(args.ySpan ?? 16)));
          const slot: AgWidgetLayoutState = { xTrack: 0, yTrack: bottom, xSpan, ySpan };
          before.set(args.page, snapshot(args.page));
          return ctx.success(
            `New widget id "${id}" on page "${args.page}", free at xTrack ${slot.xTrack}, yTrack ${slot.yTrack}, xSpan ${slot.xSpan}, ySpan ${slot.ySpan} (below everything already there). Tell the page agent to add_widget with exactly this id and position, and not to reuse any existing widget.`,
            { widgetId: id, pageId: args.page, ...slot },
          );
        },
      });

      const checkWidget: AgAiTool = api.defineAiTool({
        name: ANALYST_TOOLS.check_widget.name,
        description: ANALYST_TOOLS.check_widget.description,
        params: (s) => s.object({ page: s.enum(PAGES.map((p) => p.id)), widgetId: s.string() }),
        execute: (args: { page: string; widgetId: string }, ctx) => {
          const page = pageState(args.page);
          if (!page) return ctx.error(`There is no page "${args.page}".`);
          const w = page.widgets?.[args.widgetId];
          const l = page.widgetLayout?.[args.widgetId];
          const was = before.get(args.page) ?? {};
          const now = snapshot(args.page);
          const changed = Object.keys(was).filter((id) => id !== args.widgetId && now[id] !== undefined && now[id] !== was[id]);
          const removed = Object.keys(was).filter((id) => now[id] === undefined);
          const title = (w?.format as { title?: { text?: string } } | undefined)?.title?.text;
          const found = w
            ? `Confirmed: ${args.widgetId} is on page "${args.page}" as a ${w.type}${title ? ` titled "${title}"` : ""}${l ? ` at row ${l.yTrack}, ${l.xSpan} of 24 tracks wide` : ""}.`
            : `Not found: no widget ${args.widgetId} on page "${args.page}". Nothing was added; say so plainly.`;
          const harm = [
            changed.length ? `Changed since the slot was taken: ${changed.join(", ")}. Say so; these were already on the report.` : "",
            removed.length ? `Removed since the slot was taken: ${removed.join(", ")}. Say so.` : "",
          ]
            .filter(Boolean)
            .join(" ");
          return ctx.success(`${found} ${harm || "No widget that was already there changed."}`, { found: !!w, changed, removed });
        },
      });

      const analyst = directLlmRunner({
        id: ANALYST_ID,
        name: "Exhibit analyst",
        description: "Answers questions about the seller's PayPal disputes and changes the dashboard through Studio's agents.",
        schema: (s) => s.undefined(),
        adapter: analystAdapter,
        maxTurns: 24,
        // The server writes the analyst's real instructions (components/studio/analyst.ts) from the checked
        // context above and ignores this line.
        instructions: () => "Exhibit analyst. Instructions are built on the server.",
        tools: () => [
          deadlineLadder,
          deskLedger,
          turnToPage,
          filterLadder,
          openCaseTool,
          newWidgetSlot,
          checkWidget,
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

      // Studio's own specialists as the analyst's delegates, on the same model. The server adds Exhibit's
      // rule for additions to the page and widget agents' instructions.
      const team = (["planning", "data", "page", "widget"] as const).map((id) =>
        directLlmRunner({ ...builtIn[id], adapter: openaiAdapter({ endpoint: "/api/studio-agent", agent: id }) }),
      );

      // Opening the recorded ladder conversation shows what that run did on the page: the ladder cross-filtered to
      // the cases it picked that are still on the seller's move. No model is called; the tab it opened stays closed.
      const replay = (threadId: string) => {
        if (threadId !== LADDER_THREAD_ID) return;
        const data = read();
        const ids = data ? replayIds(LADDER_THREAD.messages as never, data.cases) : [];
        if (!ids.length) return;
        const state = api.getState();
        api.setState({ ...state, pages: state.pages.map((p) => (p.id === "deadlines" ? { ...p, crossFilter: ladderCrossFilter(p.crossFilter, ids) } : p)), selectedPageId: "deadlines" });
      };

      return { agents: [analyst, ...team], primary: ANALYST_ID, promptStarters: PROMPTS, history: seededHistory(replay) };
    });
}
