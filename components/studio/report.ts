import type { AgPageState, AgReportState, AgWidgetLayoutState } from "ag-studio";
import type { ExhibitRegistry } from "./widgets/definitions";

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

export const PAGES = [
  { id: "deadlines", title: "Deadlines", note: "What PayPal is waiting on, soonest first" },
  { id: "money", title: "Money", note: "Kept, refunded, lost and still at stake" },
  { id: "checker", title: "The checker", note: "What stood on a record, and what was struck" },
] as const;

const deadlines: Page = {
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
      format: { ...titled("Still at stake, by reason"), crossFilter: "highlight" },
    },
    "cases-grid": {
      type: "grid",
      dataMapping: {
        cols: [
          field("cases.caseId"),
          field("cases.story"),
          field("cases.buyer"),
          field("cases.stage"),
          field("cases.daysLeft"),
          field("cases.call"),
          field("cases.odds"),
          sum("cases.amount"),
        ],
      },
      sort: [{ field: { id: "cases.daysLeft" }, direction: "asc" }],
      format: titled("Every case on the desk", "Click a rung, a stamp or a bar to narrow this list"),
    },
  },
  widgetLayout: {
    ladder: at(0, 0, 14, 31),
    stages: at(14, 0, 10, 15),
    "stake-by-reason": at(14, 15, 10, 16),
    "cases-grid": at(0, 31, 24, 21),
  },
};

const money: Page = {
  id: "money",
  widgets: {
    "kpi-kept": kpi("Kept by fighting", sum("cases.kept"), "Won with evidence"),
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
      format: { ...titled("Money by Exhibit's call"), crossFilter: "highlight" },
    },
    "filed-evidence": {
      type: "bar-chart-grouped",
      dataMapping: { categoryKey: [field("cases.evidenceType")], valueKey: [sum("cases.n")] },
      format: { ...titled("What the seller filed with PayPal", "Cases by the evidence on file"), crossFilter: "highlight" },
    },
  },
  widgetLayout: {
    "kpi-kept": at(0, 0, 4, 7),
    "kpi-refunded": at(4, 0, 4, 7),
    "kpi-lost": at(8, 0, 4, 7),
    "kpi-stake": at(12, 0, 4, 7),
    "call-filter": at(16, 0, 8, 7),
    ledger: at(0, 7, 8, 26),
    "outcome-by-reason": at(8, 7, 16, 26),
    "money-by-call": at(0, 33, 12, 16),
    "filed-evidence": at(12, 33, 12, 16),
  },
};

const checker: Page = {
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
        style: { theme: { common: { legend: { enabled: true } } } },
      },
    },
    "sentence-grid": {
      type: "grid",
      dataMapping: {
        cols: [field("sentences.caseId"), field("cases.story"), field("sentences.engine"), field("sentences.kept"), field("sentences.why"), sum("sentences.n"), sum("sentences.cites")],
      },
      format: titled("Briefs, sentence by sentence"),
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
};

const PAGE_STATES = [deadlines, money, checker];

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
    const h = Math.max(16, Math.min(l.ySpan, 26));
    next[id] = at(0, y, 24, h);
    y += h;
  }
  return { ...page, widgetLayout: next };
}

export function initialReport(narrow: boolean, withAi: boolean): AgReportState<ExhibitRegistry> {
  return {
    pages: narrow ? PAGE_STATES.map(stacked) : PAGE_STATES,
    selectedPageId: "deadlines",
    panels: {
      ai: { collapsed: narrow || !withAi },
      filters: { collapsed: true },
      data: { collapsed: true },
      edit: { collapsed: true },
    },
  };
}
