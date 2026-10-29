import type { AgPageState, AgReportState, AgWidgetLayoutState } from "ag-studio";
import type { AnalyticsPayload } from "./data";
import { PAGES } from "./pages";
import { SAVED_WIDGET } from "./saved";
import { ladderRows } from "./widgets/ladder";
import type { ExhibitRegistry } from "./widgets/definitions";

export { PAGES };

/**
 * The report the analytics page opens on: three pages, each laid out on Studio's 24-column canvas.
 * Field ids ("cases.amount") are the data sources in ./data.ts. Exhibit's own widgets (the ladder, the
 * ledger, the checker's pleading paper and the stamps) sit beside Studio's KPIs, charts, grids and filters.
 */

type Page = AgPageState<ExhibitRegistry>;

const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });
const titled = (text: string, subtitle?: string) => ({
  title: { enabled: true, text },
  ...(subtitle ? { subtitle: { enabled: true, text: subtitle } } : {}),
});
const sum = (id: string) => ({ id, aggregation: "sum" as const });
const min = (id: string) => ({ id, aggregation: "min" as const });
const field = (id: string) => ({ id });

const kpi = (text: string, value: { id: string; aggregation?: "sum" }, caption: string) => ({
  type: "value" as const,
  dataMapping: { value: [value] },
  format: {
    title: { enabled: true, text },
    caption: { enabled: true, text: caption },
  },
});

// Room for the category labels on a horizontal bar chart's y axis, so case ids print in full.
const roomForLabels = { theme: { common: { legend: { enabled: true }, padding: { left: 18, right: 18 } } } };

/**
 * Deadlines. The ladder is as tall as the rungs it draws (live cases and missed ones, from the desk as it
 * loads), and the stamps stand beside it at the same height; the case list sorts live work first.
 */
function deadlines(payload: AnalyticsPayload | null): Page {
  const clocked = (payload?.cases ?? []).filter((c) => c.daysLeft != null);
  const live = clocked.filter((c) => (c.daysLeft ?? 0) >= 0).length;
  const missedCount = clocked.length - live;
  // The stamps beside the ladder need about 19 rows for six stamps.
  const h = payload ? Math.max(19, ladderRows(live, missedCount)) : 31;
  const tall = h >= 31;
  return {
    id: "deadlines",
    widgets: {
      ladder: {
        type: "exhibit-deadline-ladder",
        dataMapping: {
          case: [field("cases.caseId")],
          daysLeft: [min("cases.daysLeft")],
          amount: [sum("cases.amount")],
          label: [field("cases.story")],
        },
        format: { ...titled("Deadline ladder", "Every case on your move, soonest PayPal deadline at the top"), style: { urgentDays: 2, windowDays: 10 } },
      },
      stages: {
        type: "exhibit-stamps",
        dataMapping: { category: [field("cases.stage")], value: [sum("cases.n")] },
        format: { ...titled("Where every case stands"), style: { unit: "cases", tilt: true } },
      },
      "stake-by-reason": {
        type: "column-chart-grouped",
        dataMapping: { categoryKey: [field("cases.reason")], valueKey: [sum("cases.atStake")] },
        format: { ...titled("Still at stake, by reason", "Reasons with nothing at stake are left off"), crossFilter: "highlight" },
      },
      "cases-grid": {
        type: "grid",
        dataMapping: {
          cols: [
            field("cases.caseId"),
            field("cases.queue"),
            field("cases.daysLeft"),
            field("cases.amount"),
            field("cases.call"),
            field("cases.buyer"),
            field("cases.story"),
          ],
        },
        // Live moves first, then missed deadlines, then PayPal's queue, then decided cases.
        sort: [{ field: field("cases.queue"), direction: "asc" }],
        // One row per case, so the amount is the case's own (no "(sum)" in the header); columns sized to what they hold.
        format: {
          ...titled("Every case on the desk", "Live work first. Click a rung, a stamp or a bar to narrow it; double-click a case to open it"),
          style: { columnAutoSize: true, headerRow: { wrapText: true } },
        },
      },
    },
    widgetLayout: tall
      ? {
          ladder: at(0, 0, 14, h),
          stages: at(14, 0, 10, 15),
          "stake-by-reason": at(14, 15, 10, h - 15),
          "cases-grid": at(0, h, 24, 22),
        }
      : {
          ladder: at(0, 0, 14, h),
          stages: at(14, 0, 10, h),
          "cases-grid": at(0, h, 24, 22),
          "stake-by-reason": at(0, h + 22, 24, 15),
        },
    filter: {
      widget: { "stake-by-reason": [{ field: field("cases.atStake"), model: { operator: "greaterThan", value: 0 } }] },
    },
  };
}

function money(): Page {
  const page: Page = {
    id: "money",
    widgets: {
      "kpi-kept": kpi("Kept by fighting", sum("cases.kept"), "Won, whoever decided: see below"),
      "kpi-refunded": kpi("Refunded", sum("cases.refunded"), "Claims accepted"),
      "kpi-lost": kpi("Lost", sum("cases.lostAmount"), "Fought and lost, or late"),
      "kpi-stake": kpi("Still at stake", sum("cases.atStake"), "Not decided yet"),
      "call-filter": {
        type: "button-filter",
        dataMapping: { value: [field("cases.call")] },
        format: { ...titled("Exhibit's call"), style: { selection: { type: "multiple" }, dimensions: { height: 30 } } },
      },
      ledger: {
        type: "exhibit-ledger",
        dataMapping: {
          kept: [sum("cases.kept")],
          refunded: [sum("cases.refunded")],
          lost: [sum("cases.lostAmount")],
          atStake: [sum("cases.atStake")],
        },
        format: { ...titled("Kept, refunded, lost", "Every disputed dollar, ruled off like a ledger"), style: { showAtStake: true, showStrip: true } },
      },
      "outcome-by-reason": {
        type: "column-chart-stacked",
        dataMapping: {
          categoryKey: [field("cases.reason")],
          valueKey: [sum("cases.atStake"), sum("cases.lostAmount"), sum("cases.kept"), sum("cases.refunded")],
        },
        format: {
          ...titled("Disputed money by reason", "Still at stake, lost, kept by fighting, refunded"),
          crossFilter: "highlight",
          style: { theme: { common: { legend: { enabled: true } } } },
        },
      },
      "money-by-call": {
        type: "bar-chart-grouped",
        dataMapping: { categoryKey: [field("cases.call")], valueKey: [sum("cases.amount")] },
        format: { ...titled("Money by Exhibit's call"), crossFilter: "highlight", style: roomForLabels },
      },
      "who-decided": {
        type: "exhibit-stamps",
        dataMapping: { category: [field("cases.decided")], value: [sum("cases.n")] },
        format: {
          ...titled("Who decided", "Ruled at Exhibit's request, or closed by the sandbox on its own"),
          style: { unit: "cases", tilt: true },
        },
      },
      "filed-evidence": {
        type: "bar-chart-grouped",
        dataMapping: { categoryKey: [field("cases.evidenceType")], valueKey: [sum("cases.n")] },
        format: { ...titled("What the seller filed with PayPal", "Cases by the evidence on file"), crossFilter: "highlight", style: roomForLabels },
      },
    },
    // Four money figures at six tracks each, so no figure is cut to "…"; the call filter heads the ledger column,
    // with room for its buttons on one line and no scrollbar.
    widgetLayout: {
      "kpi-kept": at(0, 0, 6, 7),
      "kpi-refunded": at(6, 0, 6, 7),
      "kpi-lost": at(12, 0, 6, 7),
      "kpi-stake": at(18, 0, 6, 7),
      "call-filter": at(0, 7, 9, 10),
      ledger: at(0, 17, 9, 19),
      "outcome-by-reason": at(9, 7, 15, 29),
      "who-decided": at(0, 36, 9, 16),
      "money-by-call": at(9, 36, 15, 16),
      "filed-evidence": at(0, 52, 24, 15),
    },
    // Who decided counts only the cases that are over.
    filter: {
      widget: { "who-decided": [{ field: field("cases.decided"), model: { operator: "notEqual", value: "Not decided" } }] },
    },
  };
  // The widget the analyst built in the saved conversation (./saved.ts) sits where it put it.
  if (SAVED_WIDGET) {
    page.widgets![SAVED_WIDGET.id] = SAVED_WIDGET.widget as never;
    page.widgetLayout![SAVED_WIDGET.id] = SAVED_WIDGET.layout;
  }
  return page;
}

const checker = (): Page => ({
  id: "checker",
  widgets: {
    "kpi-written": kpi("Sentences written", sum("sentences.n"), "Across every brief Exhibit argued"),
    "kpi-struck": kpi("Struck by the checker", sum("cases.struck"), "No record behind them"),
    "kpi-rate": kpi("Strike rate", { id: "strikeRate" }, "Struck, of all sentences"),
    "kpi-cites": kpi("Records cited", sum("sentences.cites"), "PayPal records behind the sentences"),
    strikes: {
      type: "exhibit-checker-strikes",
      dataMapping: { verdict: [field("sentences.kept")], reason: [field("sentences.why")], count: [sum("sentences.n")] },
      format: { ...titled("Checker strikes", "Every sentence must cite a PayPal record, or it is struck"), style: { showKept: true } },
    },
    "sentences-by-case": {
      type: "bar-chart-stacked",
      dataMapping: { categoryKey: [field("sentences.caseId")], valueKey: [sum("sentences.keptCount"), sum("sentences.struckCount")] },
      format: {
        ...titled("Sentences per brief", "Kept and struck, case by case"),
        crossFilter: "highlight",
        style: roomForLabels,
      },
    },
    "sentence-grid": {
      type: "grid",
      dataMapping: {
        cols: [field("sentences.caseId"), field("sentences.kept"), field("sentences.why"), sum("sentences.cites"), field("sentences.engine"), field("cases.story")],
      },
      format: { ...titled("Briefs, sentence by sentence", "Double-click a case to open it"), style: { columnAutoSize: true, headerRow: { wrapText: true } } },
    },
  },
  widgetLayout: {
    "kpi-written": at(0, 0, 6, 7),
    "kpi-struck": at(6, 0, 6, 7),
    "kpi-rate": at(12, 0, 6, 7),
    "kpi-cites": at(18, 0, 6, 7),
    strikes: at(0, 7, 13, 25),
    "sentences-by-case": at(13, 7, 11, 25),
    "sentence-grid": at(0, 32, 24, 18),
  },
});

/**
 * A phone gets the same widgets stacked in reading order: small tiles two to a row, everything else full
 * width, so nothing needs a sideways scroll.
 */
function stacked(page: Page): Page {
  const layout = page.widgetLayout ?? {};
  const order = Object.entries(layout)
    .filter((e): e is [string, AgWidgetLayoutState] => e[1] != null)
    .sort(([, a], [, b]) => a.yTrack - b.yTrack || a.xTrack - b.xTrack);
  const next: Record<string, AgWidgetLayoutState> = {};
  let y = 0;
  let half = 0; // 0 when the row is empty, 12 when a small tile sits on its left half
  for (const [id, l] of order) {
    if (l.xSpan <= 8 && l.ySpan <= 8) {
      next[id] = at(half, y, 12, 8);
      if (half === 12) {
        y += 8;
        half = 0;
      } else half = 12;
      continue;
    }
    if (half) {
      y += 8;
      half = 0;
    }
    // The ladder keeps the height it was sized to; anything else is capped so one widget isn't a whole screen.
    // On a phone the ladder's lines wrap, so it gets a few rows more than on a desktop.
    // A short strip (the call filter) stays short, with a row for its buttons to wrap.
    const h = id === "ladder" ? Math.max(16, l.ySpan + 5) : l.ySpan <= 10 ? l.ySpan + 1 : Math.max(16, Math.min(l.ySpan, 26));
    next[id] = at(0, y, 24, h);
    y += h;
  }
  if (half) y += 8;
  return { ...page, widgetLayout: next };
}

/** Canvas rows a page fills: the bottom edge of its lowest widget. */
export function pageRows(page: Pick<Page, "widgetLayout"> | undefined): number {
  return Object.values(page?.widgetLayout ?? {}).reduce((m, l) => (l ? Math.max(m, l.yTrack + l.ySpan) : m), 0);
}

export function initialReport(narrow: boolean, payload: AnalyticsPayload | null): AgReportState<ExhibitRegistry> {
  const pages = [deadlines(payload), money(), checker()];
  return {
    pages: narrow ? pages.map(stacked) : pages,
    selectedPageId: "deadlines",
    // Opens to read: the analyst's panel stays closed until the reader asks for it, so the canvas has the
    // whole width and no figure is cut short.
    panels: {
      ai: { collapsed: true },
      filters: { collapsed: true },
      data: { collapsed: true },
      edit: { collapsed: true },
    },
  };
}
