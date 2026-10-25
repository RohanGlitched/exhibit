import { ANALYST_ID, ANALYST_TOOLS, DELEGATE_RULES, analystInstructions, type AnalystContext } from "@/components/studio/analyst";
import { TABLES_SUMMARY } from "@/components/studio/data";
import { isPageId } from "@/components/studio/pages";

/**
 * What /api/studio-agent will run, decided on the server. The analyst's instructions and its own tools are
 * written here from checked context; the browser's copies are ignored. Studio's own agents (planning, data,
 * page, widget) build their instructions from the report in the browser, so those must open the way AG's
 * agents do, and every agent may call only the tools it is known to have. No I/O, so it is unit-tested.
 */

export type AgentId = typeof ANALYST_ID | "planning" | "data" | "page" | "widget";

const STUDIO_TOOLS: Record<AgentId, string[]> = {
  [ANALYST_ID]: ["view_schema", "view_report", "view_page", "execute_query", "view_plan", "update_plan", "rename_thread", "delegate_to"],
  planning: ["view_schema", "view_report", "view_page", "view_plan", "create_plan", "complete_task"],
  data: ["execute_query", "view_schema", "create_expression", "update_expression", "delete_expression", "complete_task"],
  page: ["view_schema", "view_page", "view_plan", "add_page_filter", "remove_page_filter", "add_widget", "position_widget", "remove_widget", "complete_task"],
  widget: ["view_plan", "view_widget", "view_schema", "add_widget_filter", "remove_widget_filter", "configure_widget", "complete_task"],
};

// How AG Studio 3.0's own agents open their instructions (ag-studio defaultAgents).
const OPENINGS: Record<Exclude<AgentId, typeof ANALYST_ID>, RegExp> = {
  planning: /^You are a dashboard planning specialist\./,
  data: /^You are a data analyst\. You explore data and answer questions about it\./,
  page: /^You are the page manager\./,
  widget: /^You configure a single [\w-]+ widget/,
};

const MAX_INSTRUCTIONS = 150_000;
const MAX_TOOL_SCHEMA = 60_000;

export const isAgentId = (v: unknown): v is AgentId => typeof v === "string" && v in STUDIO_TOOLS;

/** The analyst's context from the browser, or null if any part of it is not what it should be. */
export function checkContext(v: unknown): AnalystContext | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  const count = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 1_000_000;
  if (!isPageId(c.page) || !count(c.cases) || !count(c.sentences)) return null;
  if (typeof c.at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(c.at)) return null;
  return { page: c.page, cases: c.cases as number, sentences: c.sentences as number, at: c.at };
}

/** The system prompt for this turn, or an error in words. */
export function instructionsFor(agent: AgentId, sent: unknown, context: unknown): { ok: true; text: string } | { ok: false; error: string } {
  if (agent === ANALYST_ID) return { ok: true, text: analystInstructions(checkContext(context), TABLES_SUMMARY) };
  if (typeof sent !== "string" || sent.length > MAX_INSTRUCTIONS || !OPENINGS[agent].test(sent)) {
    return { ok: false, error: "That request isn't one of the dashboard's agents." };
  }
  const rule = agent === "page" ? DELEGATE_RULES.page : agent === "widget" ? DELEGATE_RULES.widget : "";
  return { ok: true, text: sent + rule };
}

type ToolIn = { type?: unknown; name?: unknown; description?: unknown; parameters?: unknown };

/**
 * The tools this agent may call this turn: the analyst's own from the server's specs, Studio's from the
 * browser's schemas but only by known name and within a size cap. Anything else is left out.
 */
export function toolsFor(agent: AgentId, sent: unknown): { tools: { type: "function"; name: string; description: string; parameters: unknown }[]; dropped: string[] } {
  const allowed = new Set(STUDIO_TOOLS[agent]);
  const list = (Array.isArray(sent) ? sent : []) as ToolIn[];
  const tools: { type: "function"; name: string; description: string; parameters: unknown }[] = [];
  const dropped: string[] = [];
  for (const t of list) {
    const name = typeof t?.name === "string" ? t.name : "";
    if (agent === ANALYST_ID && name in ANALYST_TOOLS) {
      const spec = ANALYST_TOOLS[name as keyof typeof ANALYST_TOOLS];
      tools.push({ type: "function", name: spec.name, description: spec.description, parameters: spec.parameters });
      continue;
    }
    if (!allowed.has(name) || JSON.stringify(t.parameters ?? {}).length > MAX_TOOL_SCHEMA) {
      dropped.push(name || "(unnamed)");
      continue;
    }
    tools.push({ type: "function", name, description: typeof t.description === "string" ? t.description.slice(0, 4000) : name, parameters: t.parameters });
  }
  return { tools, dropped };
}
