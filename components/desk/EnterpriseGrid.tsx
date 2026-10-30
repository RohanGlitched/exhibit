"use client";

/**
 * The desk on AG Grid Enterprise. DeskGrid.tsx imports this file dynamically, and only when a licence key is set
 * (lib/ag-licence.ts pickGridLicence), so with no key neither this file nor AG Grid Enterprise is fetched and
 * the desk is the Community grid it always was. The options themselves are plain builders in
 * enterprise-config.ts, unit-tested in test/enterprise-desk.test.ts.
 *
 * Once NEXT_PUBLIC_AG_GRID_LICENSE_KEY is set in Vercel (or NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY is a key AG Grid
 * accepts, see lib/ag-licence.ts) and the site is redeployed, check on https://exhibit-desk.vercel.app/desk:
 *  1. No "AG Grid Enterprise License" watermark in the grid and no AG licence message in the console. If AG
 *     refuses the key, this file says why in one console warning and the desk stays on Community.
 *  2. "Money at stake by reason" appears above the filter chips as a bar chart; its bars add up to the money at
 *     stake on the cases listed, and clicking a bar lists only that reason ("Show every reason" undoes it).
 *  3. Group: "Where it stands" and "Who decided" give collapsible group rows in reading order (Your move
 *     first), each with its count and summed amount; sorting a column keeps every case under its group.
 *  4. The +/- on a case with a brief opens a detail grid of its sentences, read from /api/cases/[id], with
 *     struck sentences crossed through; "Open the case" goes to the case. A click on a case row still opens it.
 *  5. The phone layout (cards, under 760 px) is unchanged and shows no chart.
 * Without a key, NEXT_PUBLIC_AG_GRID_ENTERPRISE_PREVIEW=1 shows the same grid on localhost only (AG then logs
 * its missing-key notice in the console, and draws no watermark on localhost).
 */
import { IntegratedChartsModule, LicenseManager, MasterDetailModule, RowGroupingModule, SetFilterModule, type Module } from "ag-grid-enterprise";
import { AgChartsCommunityModule } from "ag-charts-community";
import type { ColDef, GridApi, ICellRendererParams, Theme } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { DeskRow } from "@/lib/desk";
import type { BriefSentence, Exhibit } from "@/lib/cases/types";
import { usd } from "@/lib/format";
import {
  byOfCol,
  chartFilter,
  detailHeadWords,
  enterpriseColumns,
  enterpriseOptions,
  groupLabel,
  isMaster,
  rowGroupCols,
  sentenceGridOptions,
  sentencesFor,
  stakeByReason,
  stakeChartParams,
  type EnterpriseParts,
  type SentenceRow,
} from "./enterprise-config";
import type { GroupBy } from "./rows";
import styles from "./desk.module.css";

// AG Charts Community draws the chart, so a Grid key ([01]) is enough: an AG Charts Enterprise module would
// make AG Grid ask for a Grid-and-Charts key ([0102]) instead.
const MODULES: Module[] = [RowGroupingModule, MasterDetailModule, SetFilterModule, IntegratedChartsModule.with(AgChartsCommunityModule)];

/**
 * Hands the key to AG Grid, if AG's own check takes it; false means stay on Community. With no key (the
 * localhost preview) there is nothing to check.
 */
export function prepareEnterprise(key: string | null): boolean {
  if (!key) return true;
  const d = LicenseManager.getLicenseDetails(key);
  const problem = !d.valid
    ? d.incorrectLicenseType
      ? `it is a ${d.suppliedLicenseType ?? "different"} key`
      : "AG says it is not valid"
    : d.expired
      ? `it expired ${d.expiry} (before this AG Grid release)`
      : d.isTrial && d.trialExpired
        ? `the trial ended ${d.expiry}`
        : null;
  if (problem) {
    console.warn(`Exhibit desk: the AG Grid licence key was not used (${problem}); the desk stays on AG Grid Community.`);
    return false;
  }
  LicenseManager.setLicenseKey(key);
  return true;
}

export interface EnterpriseGridProps {
  theme: Theme;
  cols: ColDef<DeskRow>[];
  rows: DeskRow[];
  groupBy: GroupBy;
  /** Where the chart goes on the page (DeskGrid renders it above the filter chips). */
  chartSlot: HTMLElement | null;
  loadBrief: (id: string) => Promise<{ sentences: BriefSentence[]; exhibits: Exhibit[] }>;
  onPainted: () => void;
  onOpen: (id: string) => void;
}

/** The +/- that opens a case's brief: AG's master row expanded or not. */
function Expand(p: ICellRendererParams<DeskRow>) {
  const node = p.node;
  const [open, setOpen] = useState(node.expanded);
  useEffect(() => {
    const sync = () => setOpen(node.expanded);
    node.addEventListener("expandedChanged", sync);
    return () => node.removeEventListener("expandedChanged", sync);
  }, [node]);
  const r = p.data;
  if (!r || node.group || !isMaster(r)) return null;
  return (
    <button
      type="button"
      className={styles.expand}
      aria-expanded={open}
      aria-label={`${open ? "Hide" : "Show"} the brief for ${r.id}`}
      title={open ? "Hide the brief" : "Show the brief, sentence by sentence"}
      onClick={(e) => {
        e.stopPropagation();
        node.setExpanded(!node.expanded);
      }}
    >
      {open ? "−" : "+"}
    </button>
  );
}

/** Inside AG's group row: the group's name, how many cases and how much money. */
function GroupInner(p: ICellRendererParams<DeskRow>) {
  const by = byOfCol(p.node.rowGroupColumn?.getColId());
  const n = p.node.allChildrenCount ?? 0;
  const amount = Number((p.node.aggData as { amount?: number } | undefined)?.amount ?? 0);
  return (
    <span className={styles.entGroup}>
      <strong>{by ? groupLabel(by, p.node.key) : p.node.key}</strong>
      <span>
        {n} case{n === 1 ? "" : "s"}, {usd(amount)}
      </span>
    </span>
  );
}

const CLASSES: EnterpriseParts["classes"] = {
  detail: styles.detail,
  detailHead: styles.detailHead,
  detailOpen: styles.detailOpen,
  detailGrid: styles.detailGrid,
  sentenceStruck: styles.sentenceStruck,
  sentenceWithdrawn: styles.sentenceWithdrawn,
  wordGood: styles.wordGood,
  wordBad: styles.wordBad,
  wordFaint: styles.wordFaint,
  groupRow: styles.entGroupRow,
  detailRow: styles.detailRow,
  mine: styles.mine,
};

/** The detail row for a case: what the brief is, a link to the case, and a grid of its sentences. */
function makeDetail(theme: Theme, loadBrief: EnterpriseParts["loadBrief"]) {
  const gridOptions = sentenceGridOptions(theme, CLASSES);
  return function SentenceDetail(p: ICellRendererParams<DeskRow>) {
    const r = p.data;
    const [rows, setRows] = useState<SentenceRow[] | null>(null);
    useEffect(() => {
      if (!r) return;
      let live = true;
      sentencesFor(loadBrief, r.id).then((x) => live && setRows(x));
      return () => {
        live = false;
      };
    }, [r]);
    if (!r) return null;
    return (
      <div className={styles.detail}>
        <p className={styles.detailHead}>
          <span className="bates">{r.id}</span>
          <span>{detailHeadWords(r)}</span>
          <Link href={`/case/${r.id}`} prefetch={false} className={styles.detailOpen}>
            Open the case
          </Link>
        </p>
        {rows ? (
          <div className={styles.detailGrid}>
            <AgGridReact<SentenceRow> {...gridOptions} rowData={rows} />
          </div>
        ) : (
          <p className={styles.detailWait}>Reading the brief from the case…</p>
        )}
      </div>
    );
  };
}

export default function EnterpriseGrid({ theme, cols, rows, groupBy, chartSlot, loadBrief, onPainted, onOpen }: EnterpriseGridProps) {
  const [api, setApi] = useState<GridApi<DeskRow> | null>(null);
  const [only, setOnly] = useState<string[] | null>(null);
  const [boxEl, setBoxEl] = useState<HTMLDivElement | null>(null);
  const columnDefs = useMemo(() => enterpriseColumns(cols, { expand: Expand }), [cols]);
  const options = useMemo(
    () => enterpriseOptions({ theme, loadBrief, groupInner: GroupInner, detail: makeDetail(theme, loadBrief), classes: CLASSES }),
    [theme, loadBrief],
  );

  useEffect(() => {
    api?.setRowGroupColumns(rowGroupCols(groupBy));
  }, [api, groupBy]);

  // The integrated chart, drawn into the slot above the chips once the grid and the slot are both there.
  useEffect(() => {
    if (!api || !boxEl) return;
    const chart = api.createCrossFilterChart(stakeChartParams(boxEl));
    return () => chart?.destroyChart();
  }, [api, boxEl]);

  const reasons = stakeByReason(rows);
  const total = reasons.reduce((n, r) => n + r.atStake, 0);
  const cases = reasons.reduce((n, r) => n + r.cases, 0);

  const chart = chartSlot
    ? createPortal(
        <figure className={styles.stakeChart}>
          <figcaption className={styles.stakeChartHead}>
            <strong>Money at stake by reason</strong>
            <span>
              {usd(total)} on the {cases} case{cases === 1 ? "" : "s"} listed below that are still in play (waiting on you, or filed and with PayPal).
              Click a bar to list only that reason.
            </span>
          </figcaption>
          {only && (
            <p className={styles.chartOnly}>
              Listing only {only.length ? only.join(", ") : "no reason"}.{" "}
              <button type="button" onClick={() => api?.setFilterModel(null)}>
                Show every reason
              </button>
            </p>
          )}
          <div className={styles.stakeChartBox} ref={setBoxEl} aria-hidden="true" />
          <ul className="srOnly">
            {reasons.map((r) => (
              <li key={r.reason}>
                {r.reason}: {usd(r.atStake)} at stake on {r.cases} case{r.cases === 1 ? "" : "s"}
              </li>
            ))}
          </ul>
        </figure>,
        chartSlot,
      )
    : null;

  return (
    <>
      {chart}
      <AgGridReact<DeskRow>
        {...options}
        modules={MODULES}
        theme={theme}
        rowData={rows}
        columnDefs={columnDefs}
        getRowId={(p) => p.data.id}
        onFirstDataRendered={onPainted}
        onGridReady={(e) => {
          setApi(e.api);
          if (!e.api.getDisplayedRowCount()) onPainted();
        }}
        onFilterChanged={(e) => setOnly(chartFilter(e.api.getFilterModel()))}
        onRowClicked={(e) => {
          // Group rows fold and unfold, the brief under a case is read where it is; a click on a case row opens the case.
          if (e.node.group || e.node.detail) return;
          if ((e.event?.target as HTMLElement | null)?.closest?.("a, button")) return;
          if (e.data) onOpen(e.data.id);
        }}
        rowClass={styles.row}
        domLayout="autoHeight"
        suppressCellFocus
        tooltipShowDelay={300}
        overlayNoRowsTemplate="No cases yet. Open one and it lands here."
        defaultColDef={{ sortable: true, resizable: true }}
      />
    </>
  );
}
