import type { AgAiChatMessage, AgWidgetLayoutState } from "ag-studio";

/**
 * One saved conversation with the Exhibit analyst, recorded from a real run, so the analyst's panel opens on
 * an exchange that built a widget instead of an empty box. The widget that run built is part of the report
 * the page opens on (report.ts), where the run put it.
 */
export const SAVED_WIDGET: { id: string; widget: unknown; layout: AgWidgetLayoutState } | null = null;

export const SAVED_THREAD: { title: string; messages: AgAiChatMessage[] } | null = null;
