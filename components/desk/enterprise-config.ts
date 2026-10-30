/**
 * The desk's AG Grid Enterprise set-up, as plain builders: no React, no AG Grid Enterprise import (only AG Grid's
 * types), so it type-checks with the rest of the app and runs in the unit tests (test/enterprise-desk.test.ts).
 * components/desk/EnterpriseGrid.tsx feeds these to AgGridReact once a licence key is set; with no key none of
 * this runs and the desk is the Community grid in DeskGrid.tsx.
 *
 * Behind the key the desk gets three Enterprise features:
 *  1. Row grouping (RowGroupingModule): "Where it stands" and "Who decided" group through two hidden columns,
 *     with collapsible group rows that carry the count and the summed amount. This replaces the hand-built
 *     full-width group rows the Community grid keeps in order with postSortRows.
 *  2. Master/detail (MasterDetailModule): a case with a brief opens a detail grid of its sentences (number,
 *     sentence, exhibits cited, the checker's word), read from /api/cases/[id] on first open.
 *  3. An integrated cross-filter chart (IntegratedChartsModule with AG Charts Community): money at stake by
 *     reason, summed over the cases listed in the grid. Clicking a bar filters the grid to that reason.
 */
import type {
  ColDef,
  CreateCrossFilterChartParams,
  GridOptions,
  ICellRendererParams,
  InitialGroupOrderComparatorParams,
  IRowNode,
  RowClassParams,
  Theme,
  ValueGetterParams,
} from "ag-grid-community";
import type { DeskRow } from "@/lib/desk";
import type { BriefSentence, Exhibit } from "@/lib/cases/types";
import { sentenceState, type SentenceState } from "../../lib/cases/sentence-state";
import { reasonLabel, usd } from "../../lib/format";
import { GROUP_LABELS, arguedBy, groupKey, isMissed, sentenceWord, type GroupBy } from "./rows";

/** Hidden columns the enterprise grid adds: two to group by, two the chart reads. */
export const GROUP_COL: Record<Exclude<GroupBy, "none">, string> = { stage: "deskStage", decided: "deskDecided" };
export const REASON_COL = "deskReason";
export const STAKE_COL = "deskStake";

/** The columns to group by for the desk's Group switch. */
export const rowGroupCols = (by: GroupBy): string[] => (by === "none" ? [] : [GROUP_COL[by]]);

/** Which Group switch a hidden group column belongs to. */
export const byOfCol = (colId: string | undefined): Exclude<GroupBy, "none"> | null =>
  colId === GROUP_COL.stage ? "stage" : colId === GROUP_COL.decided ? "decided" : null;

/** A group's name in words, from its key ("waiting" is "Your move"). */
export function groupLabel(by: Exclude<GroupBy, "none">, key: string | null | undefined): string {
  return GROUP_LABELS[by].find(([k]) => k === key)?.[1] ?? key ?? "Other";
}

/** A group's place in the desk's reading order: the seller's live work first, then PayPal's queue, then what is over. */
export function groupOrder(by: Exclude<GroupBy, "none">, key: string | null | undefined): number {
  const i = GROUP_LABELS[by].findIndex(([k]) => k === key);
  return i < 0 ? GROUP_LABELS[by].length : i;
}

/**
 * Money still in play on a case, the same rule as the desk's toolbar figure (lib/desk-counts.ts atStake):
 * waiting on the seller with the deadline ahead, or filed and with PayPal. A missed deadline is not.
 */
export function stakeOf(r: Pick<DeskRow, "where" | "status" | "due" | "amount">, now = Date.now()): number {
  return (r.where === "waiting" || r.where === "filed" || r.where === "open") && !isMissed(r, now) ? r.amount : 0;
}

/** The chart's figures without the chart: money at stake by reason, largest first, reasons with none left out. */
export function stakeByReason(
  rows: Pick<DeskRow, "where" | "status" | "due" | "amount" | "reason">[],
  now = Date.now(),
): { reason: string; atStake: number; cases: number }[] {
  const by = new Map<string, { reason: string; atStake: number; cases: number }>();
  for (const r of rows) {
    const s = stakeOf(r, now);
    if (!s) continue;
    const label = reasonLabel(r.reason);
    const cur = by.get(label) ?? { reason: label, atStake: 0, cases: 0 };
    cur.atStake += s;
    cur.cases += 1;
    by.set(label, cur);
  }
  return [...by.values()].sort((a, b) => b.atStake - a.atStake || a.reason.localeCompare(b.reason));
}

type Node = Pick<IRowNode<DeskRow>, "data" | "allLeafChildren">;

/**
 * The chart's category for a row node. A cross-filter chart reads every node, group rows included; a group
 * row has no data, so it is given the reason of its first case and no money (stakeValue), which puts it in a
 * bar that already exists and adds nothing to it, instead of an empty "undefined" bar.
 */
export function chartReason(node: Node | null | undefined): string | undefined {
  const d = node?.data ?? node?.allLeafChildren?.find((n) => n.data)?.data;
  return d ? reasonLabel(d.reason) : undefined;
}

/** The chart's figure for a row node: the money at stake on a case; nothing for a group row. */
export const stakeValue = (data: DeskRow | undefined, now = Date.now()): number | undefined => (data ? stakeOf(data, now) : undefined);

/**
 * The enterprise columns: the desk's own columns (the +/- column takes the enterprise expander, amounts sum
 * into their group row, nothing else is charted), then the hidden group and chart columns.
 */
export function enterpriseColumns(base: ColDef<DeskRow>[], parts: { expand: ColDef<DeskRow>["cellRenderer"] }): ColDef<DeskRow>[] {
  const own = base.map((c): ColDef<DeskRow> => {
    const col: ColDef<DeskRow> = { ...c, chartDataType: "excluded" };
    if (c.colId === "expand") col.cellRenderer = parts.expand;
    if (c.field === "amount") col.aggFunc = "sum";
    return col;
  });
  const group = (by: Exclude<GroupBy, "none">, headerName: string): ColDef<DeskRow> => ({
    colId: GROUP_COL[by],
    headerName,
    hide: true,
    enableRowGroup: true,
    chartDataType: "excluded",
    valueGetter: (p: ValueGetterParams<DeskRow>) => (p.data ? groupKey(p.data, by) : undefined),
    comparator: (a: string, b: string) => groupOrder(by, a) - groupOrder(by, b),
  });
  return [
    ...own,
    group("stage", "Where it stands"),
    group("decided", "Who decided"),
    {
      colId: REASON_COL,
      headerName: "Reason",
      hide: true,
      chartDataType: "category",
      filter: "agSetColumnFilter",
      valueGetter: (p: ValueGetterParams<DeskRow>) => chartReason(p.node),
    },
    {
      colId: STAKE_COL,
      headerName: "At stake",
      hide: true,
      chartDataType: "series",
      valueGetter: (p: ValueGetterParams<DeskRow>) => stakeValue(p.data),
    },
  ];
}

/** A row of the detail grid: one sentence of the brief. */
export interface SentenceRow {
  n: number;
  text: string;
  cites: string;
  kind: SentenceState["kind"];
  word: string;
}

/** A brief's sentences as detail-grid rows. */
export function sentenceRows(brief: { sentences: BriefSentence[]; exhibits: Exhibit[] }): SentenceRow[] {
  return brief.sentences.map((s, i) => {
    const st = sentenceState(s, brief.exhibits);
    return { n: i + 1, text: s.text, cites: s.cites.join(", "), kind: st.kind, word: sentenceWord(s, st) };
  });
}

/** A case's sentences for its detail grid, read once per page view; a brief that can't be read is an empty grid. */
export function sentencesFor(loadBrief: EnterpriseParts["loadBrief"], id: string): Promise<SentenceRow[]> {
  return loadBrief(id)
    .then(sentenceRows)
    .catch(() => []);
}

/** Class names the enterprise grid's detail rows use (desk.module.css). */
export interface DetailClasses {
  detail: string;
  detailHead: string;
  detailOpen: string;
  detailGrid: string;
  sentenceStruck: string;
  sentenceWithdrawn: string;
  wordGood: string;
  wordBad: string;
  wordFaint: string;
}

/** The line over a case's detail grid: what the brief is and who argued it. */
export function detailHeadWords(r: Pick<DeskRow, "sentences" | "engine">): string {
  const n = r.sentences ?? 0;
  return `The brief, ${n} sentence${n === 1 ? "" : "s"}, ${arguedBy(r.engine)}`;
}

/** The detail grid: one row per sentence, as tall as its text, sorted by number. */
export function sentenceGridOptions(theme: Theme, cls: DetailClasses): GridOptions<SentenceRow> {
  return {
    theme,
    columnDefs: sentenceColumns(cls),
    defaultColDef: { sortable: true, resizable: true },
    domLayout: "autoHeight",
    suppressCellFocus: true,
    headerHeight: 34,
    getRowId: (p) => String(p.data.n),
    overlayNoRowsTemplate: "No brief on record for this case.",
  };
}

/** The detail grid's columns. */
export function sentenceColumns(cls: DetailClasses): ColDef<SentenceRow>[] {
  return [
    { field: "n", headerName: "#", width: 58, sort: "asc", type: "rightAligned" },
    {
      field: "text",
      headerName: "Sentence",
      flex: 1,
      minWidth: 260,
      wrapText: true,
      autoHeight: true,
      cellClassRules: { [cls.sentenceStruck]: (p) => p.data?.kind === "struck", [cls.sentenceWithdrawn]: (p) => p.data?.kind === "withdrawn" },
    },
    { field: "cites", headerName: "Exhibits", width: 110, cellClass: "bates" },
    {
      field: "word",
      headerName: "Checker",
      width: 290,
      wrapText: true,
      autoHeight: true,
      cellClassRules: {
        [cls.wordGood]: (p) => p.data?.kind === "checked" || p.data?.kind === "quoted",
        [cls.wordBad]: (p) => p.data?.kind === "struck",
        [cls.wordFaint]: (p) => p.data?.kind === "unverified" || p.data?.kind === "withdrawn",
      },
    },
  ];
}

export interface EnterpriseParts {
  theme: Theme;
  classes: DetailClasses & { groupRow: string; detailRow: string; mine: string };
  /** The brief behind a case, read once per page view. */
  loadBrief: (id: string) => Promise<{ sentences: BriefSentence[]; exhibits: Exhibit[] }>;
  /** What a group row shows inside AG's group cell: its name, count and money. */
  groupInner: (p: ICellRendererParams<DeskRow>) => unknown;
  /**
   * The detail row (a React component: AG Grid React does not take a detail template), which draws the
   * header and the sentence grid from detailHeadWords and sentenceGridOptions.
   */
  detail: (p: ICellRendererParams<DeskRow>) => unknown;
}

/** A case with a brief on record opens; one with none has nothing to show. */
export const isMaster = (r: Pick<DeskRow, "sentences"> | undefined) => r != null && r.sentences != null;

/** Group rows in the desk's reading order whatever order the cases arrive in. */
export function groupComparator(p: Pick<InitialGroupOrderComparatorParams<DeskRow>, "nodeA" | "nodeB">): number {
  const at = (n: IRowNode<DeskRow>) => {
    const by = byOfCol(n.rowGroupColumn?.getColId());
    return by ? groupOrder(by, n.key) : 0;
  };
  return at(p.nodeA) - at(p.nodeB);
}

/** The grid options only the enterprise grid sets. */
export function enterpriseOptions(parts: EnterpriseParts): GridOptions<DeskRow> {
  const { classes: cls } = parts;
  return {
    // Row grouping: group rows across the whole width, open, in reading order, with the amounts summed.
    groupDisplayType: "groupRows",
    groupDefaultExpanded: -1,
    // ...but briefs stay shut until asked for (masters would otherwise follow groupDefaultExpanded).
    masterDefaultExpanded: 0,
    groupRowRendererParams: { innerRenderer: parts.groupInner, suppressCount: true },
    initialGroupOrderComparator: groupComparator,
    suppressAggFuncInHeader: true,
    // Master/detail: the brief's sentences in a grid of their own under the case.
    masterDetail: true,
    isRowMaster: isMaster,
    detailRowAutoHeight: true,
    keepDetailRows: true,
    detailCellRenderer: parts.detail,
    // The chart: AG's own chart, drawn from the grid's rows.
    enableCharts: true,
    getChartToolbarItems: () => ["chartDownload"],
    getRowClass: (p: RowClassParams<DeskRow>) => {
      if (p.node.group) return cls.groupRow;
      if (p.node.detail) return cls.detailRow;
      return p.data?.mine ? cls.mine : undefined;
    },
    // No getRowHeight: with one, AG sets --ag-line-height on the detail row from it, and the sentence grid inside
    // inherits it and draws its text at zero line height.
  };
}

/** The chart's colours and type, matched to the desk: the seller's blue, ink axes, dollars on the value axis. */
export function stakeChartParams(container: HTMLElement): CreateCrossFilterChartParams {
  return {
    chartType: "bar",
    cellRange: { columns: [REASON_COL, STAKE_COL] },
    aggFunc: "sum",
    chartContainer: container,
    suppressChartRanges: true,
    sort: [{ colId: STAKE_COL, sort: "desc" }],
    chartThemeName: "ag-default",
    chartThemeOverrides: {
      common: {
        background: { fill: "#fbfcfd" },
        padding: { top: 6, right: 18, bottom: 6, left: 6 },
        legend: { enabled: false },
        title: { enabled: false },
      },
      bar: {
        series: {
          fill: "#2b63e8",
          stroke: "#2b63e8",
          fillOpacity: 1,
          tooltip: {
            renderer: ({ datum, xKey, yKey }) => ({
              heading: String(datum[xKey]),
              data: [{ label: "At stake", value: usd(Number(datum[yKey] ?? 0)) }],
            }),
          },
        },
        axes: {
          number: { label: { formatter: ({ value }) => usd(Number(value)), color: "#57627a" }, gridLine: { style: [{ stroke: "#e6ebf2" }] } },
          category: { label: { color: "#13203a" } },
        },
      },
    },
  };
}

/** The reasons the chart has filtered the grid to, read from the grid's filter model; null when it hasn't. */
export function chartFilter(model: Record<string, unknown> | null | undefined): string[] | null {
  const m = model?.[REASON_COL] as { filterType?: string; values?: (string | null)[] } | undefined;
  if (!m || m.filterType !== "set" || !Array.isArray(m.values)) return null;
  return m.values.filter((v): v is string => typeof v === "string");
}
