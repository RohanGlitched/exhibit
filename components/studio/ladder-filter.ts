import type { AgCrossFilterState } from "ag-studio";

/**
 * The analyst's filter_ladder and open_case, as plain data: the cross-filter a reader sets by clicking rungs
 * of the deadline ladder, written into the Deadlines page's state, and which of the ids the analyst asked for
 * the desk actually holds. Pure, so the tests can check it without Studio.
 */

/** The ladder's widget id on the Deadlines page (report.ts) and the field its rungs filter on. */
export const LADDER_WIDGET = "ladder";
export const CASE_FIELD = "cases.caseId";

/** The page's cross-filter with the ladder's selection set to `ids` (cleared when empty); other widgets' selections are kept. */
export function ladderCrossFilter(current: AgCrossFilterState | undefined, ids: string[]): AgCrossFilterState {
  const values = { ...(current?.values ?? {}) };
  if (ids.length) values[LADDER_WIDGET] = [{ type: "value", group: 0, field: { id: CASE_FIELD }, values: [...ids] }];
  else delete values[LADDER_WIDGET];
  return { values };
}

/** The ladder's current selection on a page's cross-filter state. */
export function ladderSelection(current: AgCrossFilterState | undefined): string[] {
  const s = current?.values?.[LADDER_WIDGET]?.find((x) => x.type === "value");
  return s && s.type === "value" ? s.values.map(String) : [];
}

/** Splits the ids asked for into the ones the desk holds (in the order asked, once each) and the ones it doesn't. */
export function knownCases(asked: string[], desk: { caseId: string }[]): { kept: string[]; unknown: string[] } {
  const held = new Set(desk.map((c) => c.caseId));
  const ids = [...new Set(asked.map((a) => String(a).trim().toUpperCase()).filter(Boolean))];
  return { kept: ids.filter((i) => held.has(i)), unknown: ids.filter((i) => !held.has(i)) };
}

type Part = { type?: string; toolCall?: { name?: string; args?: { caseIds?: unknown } } };

/**
 * The cases a recorded conversation filtered the ladder to (its last filter_ladder call), kept only while each
 * is still on the seller's move, so replaying the record never filters the ladder to nothing.
 */
export function replayIds(messages: { parts?: Part[] }[], desk: { caseId: string; daysLeft: number | null }[]): string[] {
  const call = messages
    .flatMap((m) => m.parts ?? [])
    .filter((p) => p.type === "tool_call" && p.toolCall?.name === "filter_ladder")
    .at(-1);
  const asked = Array.isArray(call?.toolCall?.args?.caseIds) ? (call!.toolCall!.args!.caseIds as unknown[]).map(String) : [];
  const live = new Set(desk.filter((c) => c.daysLeft != null && c.daysLeft >= 0).map((c) => c.caseId));
  return asked.filter((id) => live.has(id));
}
