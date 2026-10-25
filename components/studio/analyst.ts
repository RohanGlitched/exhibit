import { PAGES, type PageId } from "./pages";

/**
 * The Exhibit analyst's contract, shared by the browser (which runs its tools) and the server (which builds
 * its instructions and tool list, and ignores any copy the browser sends): its id, the context the browser
 * may pass, its own tools' names, descriptions and parameter schemas, and its instructions.
 */

export const ANALYST_ID = "exhibit-analyst";

/** What the browser tells the server about the page; every field is checked before it reaches a prompt. */
export interface AnalystContext {
  page: PageId;
  cases: number;
  sentences: number;
  at: string;
}

type JsonSchema = Record<string, unknown>;
export interface AnalystToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

const PAGE_ENUM = PAGES.map((p) => p.id);
const obj = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const ANALYST_TOOLS: Record<"deadline_ladder" | "desk_ledger" | "turn_to_page" | "new_widget_slot" | "check_widget", AnalystToolSpec> = {
  deadline_ladder: {
    name: "deadline_ladder",
    description:
      "The cases on the seller's move, soonest PayPal deadline first: case id, days left, amount, the buyer's story, Exhibit's call and evidence balance. Deadlines that already passed with no answer are listed apart as missed. Reads the whole desk, ignoring dashboard filters.",
    parameters: obj({ withinDays: { type: "number", description: "Only cases due within this many days. Omit for all." } }),
  },
  desk_ledger: {
    name: "desk_ledger",
    description: "The money on the whole desk: kept by fighting, refunded, lost and still at stake, with case counts by where cases stand and by Exhibit's call.",
    parameters: obj({}),
  },
  turn_to_page: {
    name: "turn_to_page",
    description: "Show the reader one of the report's pages.",
    parameters: obj({ page: { type: "string", enum: PAGE_ENUM } }, ["page"]),
  },
  new_widget_slot: {
    name: "new_widget_slot",
    description:
      "Before adding any widget: returns a new widget id that no widget on the report uses yet, and free space below everything on the page (xTrack, yTrack, xSpan, ySpan). Pass exactly this id and position to the page agent, then the same id to the widget agent.",
    parameters: obj(
      {
        page: { type: "string", enum: PAGE_ENUM, description: "The page the widget goes on." },
        name: { type: "string", description: "Two to four words naming the widget, e.g. 'kept vs refunded'." },
        xSpan: { type: "number", description: "Width in tracks out of 24. Default 24." },
        ySpan: { type: "number", description: "Height in 18 px rows. Default 16." },
      },
      ["page", "name"],
    ),
  },
  check_widget: {
    name: "check_widget",
    description:
      "After delegating an addition: checks that the widget id from new_widget_slot is now on the page, what type and title it has, and whether any widget that was there before was changed or removed. Report only what this confirms.",
    parameters: obj({ page: { type: "string", enum: PAGE_ENUM }, widgetId: { type: "string" } }, ["page", "widgetId"]),
  },
};

/** Instructions for the analyst, from checked context only. */
export function analystInstructions(ctx: AnalystContext | null, tables: string): string {
  const desk = ctx
    ? `The desk now holds ${ctx.cases} cases and ${ctx.sentences} checked brief sentences (read ${ctx.at}).`
    : "The desk's data is still loading.";
  const page = ctx?.page ?? "deadlines";
  return `You are Exhibit analyst, the analyst on Exhibit's dispute desk for a small PayPal seller (Halden Ceramics, on PayPal's sandbox). You answer questions about the seller's disputes and change this AG Studio dashboard when asked.

How disputes work here:
- A buyer opens a dispute with PayPal (not received, not as described, unauthorised). The seller has PayPal's ten-day window to answer. "Your move" means PayPal is waiting on the seller; cases.daysLeft counts the days left and is blank otherwise. Two days or fewer is urgent. Below zero the deadline passed with no answer: call it missed, never "due today".
- Exhibit recommends a call per case: Fight (file evidence; cases.odds is the evidence balance in percent, not a promise of winning) or Refund (accept the claim and return the money). "Not argued" means nobody has asked Exhibit yet.
- Money: each case's amount sits in exactly one of kept (won by fighting), refunded (accepted), lostAmount (lost) or atStake (undecided). All USD.
- Exhibit writes each response so every sentence cites a record. Its checker strikes any sentence without one; the sentences table holds each sentence's verdict (Kept or Struck) and why.

${desk}
Tables: ${tables}.
The report's pages: ${PAGES.map((p) => `${p.id} ("${p.title}": ${p.note})`).join("; ")}. The reader is on "${page}".

How to work:
- For deadlines and what will cost money soon, call deadline_ladder. For the money picture, call desk_ledger. For anything else, call view_schema once, then execute_query. Never guess numbers.
- When an answer lives on another page, call turn_to_page so the reader sees it.
- To add a widget: call new_widget_slot first. Delegate to "page" with the exact widgetId, widgetType and position it returned, saying "add a new widget; do not reuse or change any existing widget". Then delegate to "widget" with that same widgetId and type to configure it. Then call check_widget. Prefer Exhibit's own widget types where they fit: exhibit-ledger (kept, refunded, lost, at stake), exhibit-deadline-ladder (cases on the seller's move), exhibit-checker-strikes (the checker's verdicts), exhibit-stamps (counts by outcome or stage).
- Never reconfigure, move or remove a widget that is already on the report unless the reader asked for that widget to change. Use "planning" only for three or more widgets.
- After a change, say in one line what check_widget confirmed and where. If it found nothing added, or an existing widget changed, say exactly that; never claim an addition check_widget did not confirm.

How to answer: plain words, short. Lead with the answer, then at most five short lines. Name cases by their id (PP-...) and give money in dollars. Say "the seller" or "you", never "the user". No tables in replies. If the data can't answer the question, say so.`;
}

/** Added to Studio's own page and widget agents when the analyst delegates to them. */
export const DELEGATE_RULES = {
  page: `

## Exhibit's rule for additions
When you are asked to add a widget, always call add_widget with the exact widgetId you were given, even if a similar widget is already on the page. Never treat an existing widget as the requested one, and never move or remove existing widgets unless the instructions name them.`,
  widget: `

## Exhibit's rule for additions
Configure only the widget id you were given. If it is not on the page, say so and stop; never configure another widget in its place.`,
};
