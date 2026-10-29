"use client";

import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams, type RowClassParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { DeskRow } from "@/lib/desk";
import { reasonLabel, shortDay, usd } from "@/lib/format";
import { DECIDED_TINY, callCell, callWords, dueWords, isLive, isMissed, shortFiled } from "./rows";
import styles from "./desk.module.css";

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  fontFamily: "var(--font-sans)",
  fontSize: 14,
  foregroundColor: "#13203a",
  backgroundColor: "#fbfcfd",
  headerBackgroundColor: "#f1f4f9",
  headerTextColor: "#57627a",
  headerFontWeight: 600,
  headerFontSize: 13,
  borderColor: "#dbe2ec",
  rowBorder: { color: "#e6ebf2" },
  wrapperBorder: false,
  wrapperBorderRadius: 3,
  accentColor: "#2b63e8",
  selectedRowBackgroundColor: "#e6edfd",
  rowHoverColor: "#f1f5fd",
  spacing: 7,
  rowHeight: 50,
  headerHeight: 42,
  cellHorizontalPadding: 10,
});

// Keyed by string so a stage the desk adds later (such as "lapsed") still reads in words.
const WHERE: Record<string, string> = {
  open: "PayPal reviewing",
  waiting: "Your move",
  lapsed: "Missed",
  filed: "Filed",
  refunded: "Refunded",
  won: "Won",
  lost: "Lost",
  reviewing: "PayPal reviewing",
  other: "Other",
};

// Missed deadlines are not in any of these: they sit in their own folded section under the list.
const FILTERS: { id: string; label: string; test: ((r: DeskRow) => boolean) | null }[] = [
  { id: "all", label: "All", test: null },
  { id: "waiting", label: "Your move", test: (r) => isLive(r) },
  { id: "reviewing", label: "PayPal reviewing", test: (r) => ["open", "filed", "reviewing"].includes(r.where) },
  { id: "won", label: "Won", test: (r) => r.where === "won" },
  { id: "refunded", label: "Refunded", test: (r) => r.where === "refunded" },
  { id: "lost", label: "Lost", test: (r) => r.where === "lost" },
];

const label = (r: DeskRow) => (r.pooled ? "In the house pool" : isMissed(r) ? "Missed" : (WHERE[r.where] ?? r.status));

/**
 * The case id as a Bates number and a real link: it opens in a new tab, and Next prefetches the case. Every
 * row is on screen at once, so the full case (a server render that reads PayPal) is fetched on hover, not
 * for all sixty rows on load.
 */
function CaseId({ value }: ICellRendererParams<DeskRow, string>) {
  const router = useRouter();
  if (!value) return null;
  const href = `/case/${value}`;
  const warm = () => router.prefetch(href, { kind: "full" } as unknown as Parameters<typeof router.prefetch>[1]);
  return (
    <Link href={href} className={`bates ${styles.caseLink}`} onMouseEnter={warm} onFocus={warm}>
      {value}
    </Link>
  );
}

function Due({ value, data }: ICellRendererParams<DeskRow, string | null>) {
  if (!value || !data || (data.status !== "WAITING_FOR_SELLER_RESPONSE" && !isMissed(data))) return <span className={styles.muted}>—</span>;
  const due = dueWords(value);
  if (due.missed)
    return (
      <span className={styles.missed} title={`PayPal's deadline passed ${-due.days} day${due.days === -1 ? "" : "s"} ago with no answer`}>
        {due.text}
      </span>
    );
  const pct = Math.max(0, Math.min(100, (due.days / 10) * 100));
  return (
    <span className={styles.due} data-soon={due.days <= 2}>
      <span className={styles.dueBar}>
        <i style={{ width: `${pct}%` }} />
      </span>
      {due.text}
    </span>
  );
}

const BALANCE_TIP = "Evidence balance: how much of the brief's tally favours the seller. It is not a chance of winning.";

/** Exhibit's call, with the evidence balance while the case is open; once PayPal has decided, who decided it. */
function Call({ data }: ICellRendererParams<DeskRow, number | null>) {
  if (!data) return null;
  const c = callCell(data);
  if (!c.call) return <span className={styles.muted}>{c.note ?? "Not argued"}</span>;
  if (c.balance == null)
    return (
      <span className={styles.odds} title={c.note ? `PayPal's decision: ${c.note}` : "Read back from the filing PayPal holds; no evidence balance was recorded"}>
        <b data-rec={data.recommendation}>{c.call}</b>
        {c.note && data.decidedBy && <span className={styles.decided}>{DECIDED_TINY[data.decidedBy]}</span>}
      </span>
    );
  return (
    <span className={styles.odds} title={BALANCE_TIP}>
      <b data-rec={data.recommendation}>{c.call}</b>
      <span className={styles.oddsBar}>
        <i style={{ width: `${c.balance}%` }} />
      </span>
      {c.balance}%
    </span>
  );
}

function Status({ data }: ICellRendererParams<DeskRow, string>) {
  if (!data) return null;
  const missed = isMissed(data);
  return (
    <span className={styles.status} data-where={missed ? "lapsed" : data.where} title={missed ? "PayPal's deadline passed with no answer" : data.whereLine}>
      {label(data)}
    </span>
  );
}

export default function DeskGrid({ initial }: { initial: DeskRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [mineOnly, setMineOnly] = useState(false);
  const [quick, setQuick] = useState("");
  const [filter, setFilter] = useState("all");
  const [probes, setProbes] = useState(false);
  // AG Grid paints only once its script has run; until then the same rows show as plain paper rows.
  const [painted, setPainted] = useState(false);

  useEffect(() => {
    const t = setInterval(async () => {
      const r = await fetch("/api/cases", { cache: "no-store" }).catch(() => null);
      if (r?.ok) setRows(((await r.json()) as { rows: DeskRow[] }).rows);
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  // Fixed widths that fit the 1,200 px desk with every column whole ("Evidence + PDF", "Fight sandbox closed it");
  // reason and buyer take what is left.
  const cols = useMemo<ColDef<DeskRow>[]>(
    () => [
      { field: "id", headerName: "Case", width: 204, cellRenderer: CaseId, pinned: "left" },
      { field: "reason", headerName: "Reason", flex: 1, minWidth: 128, valueFormatter: (p) => reasonLabel(p.value ?? "") },
      { field: "amount", headerName: "Amount", width: 86, type: "rightAligned", valueFormatter: (p) => usd(p.value ?? 0) },
      { field: "buyer", headerName: "Buyer", flex: 1, minWidth: 118, valueFormatter: (p) => p.value ?? "—" },
      { field: "where", headerName: "Where it stands", width: 134, cellRenderer: Status },
      {
        field: "due",
        headerName: "Respond in",
        width: 98,
        cellRenderer: Due,
        sort: "asc",
        // Live deadlines first, soonest at the top; missed ones after them; cases off the clock last.
        comparator: (a, b, na, nb) => {
          const rank = (r: DeskRow | undefined, v: string | null) => (!v || !r ? 2 : isMissed(r) ? 1 : r.status === "WAITING_FOR_SELLER_RESPONSE" ? 0 : 2);
          const ra = rank(na?.data, a);
          const rb = rank(nb?.data, b);
          if (ra !== rb) return ra - rb;
          if (ra === 1) return (b ?? "").localeCompare(a ?? ""); // most recently missed first
          return (a ?? "9").localeCompare(b ?? "9");
        },
      },
      { field: "odds", headerName: "Call · evidence balance", headerTooltip: BALANCE_TIP, width: 190, cellRenderer: Call },
      {
        field: "filed",
        headerName: "Filed",
        width: 136,
        tooltipValueGetter: (p) => p.data?.filed ?? null,
        valueGetter: (p) => (p.data ? shortFiled(p.data) : ""),
      },
      { field: "opened", headerName: "Opened", width: 70, valueFormatter: (p) => (p.value ? shortDay(p.value) : "") },
    ],
    [],
  );

  // Pool cases are stock waiting for the next visitor (and retired stock never reached anyone): count them,
  // don't list them. Build-day API probes are real disputes too, listed on request.
  const pooled = rows.filter((r) => r.pooled).length;
  const retired = rows.filter((r) => r.retired).length;
  const probeCount = rows.filter((r) => r.source === "probe").length;
  const desk = rows.filter((r) => !r.pooled && !r.retired && (probes || r.source !== "probe"));
  // Cases that missed PayPal's deadline are kept unanswered on purpose and listed apart, folded, below the desk.
  const missed = desk.filter((r) => isMissed(r)).sort((a, b) => (b.due ?? "").localeCompare(a.due ?? ""));
  const live = desk.filter((r) => !isMissed(r));
  const test = FILTERS.find((f) => f.id === filter)?.test;
  const shown = live.filter((r) => (!mineOnly || r.mine) && (!test || test(r)));
  const open = live.filter((r) => isLive(r)).length;
  const missedCount = missed.length;
  // A missed deadline is not money still in play: PayPal decides those for the buyer.
  const atStake = live.filter((r) => isLive(r) || r.where === "filed" || r.where === "open").reduce((s, r) => s + r.amount, 0);

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <p className={styles.counts}>
          <strong>{open}</strong> waiting on the seller, <strong>{usd(atStake)}</strong> at stake
          {missedCount > 0 && <span className={styles.pool}>; {missedCount} missed PayPal&apos;s deadline (listed under the desk)</span>}
          {pooled > 0 && <span className={styles.pool}>, plus {pooled} opened ahead for the next visitors</span>}
          {retired > 0 && <span className={styles.pool}> ({retired} more retired from the pool unused)</span>}
        </p>
        <div className={styles.controls}>
          <label className={styles.search}>
            <span className="srOnly">Filter cases</span>
            <input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Filter by case, buyer, reason" />
          </label>
          <label className={styles.toggle}>
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
            Only cases I opened
          </label>
          {probeCount > 0 && (
            <label className={styles.toggle}>
              <input type="checkbox" checked={probes} onChange={(e) => setProbes(e.target.checked)} />
              Build-day API probes ({probeCount})
            </label>
          )}
        </div>
      </div>
      <div className={styles.filters} role="group" aria-label="Show cases">
        {FILTERS.map((f) => {
          const n = f.test ? live.filter(f.test).length : live.length;
          return (
            <button key={f.id} type="button" className={styles.chip} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label} <span>{n}</span>
            </button>
          );
        })}
      </div>
      <ol className={styles.cards}>
        {shown.map((r) => {
          const call = callWords(r);
          const due = r.due && (r.status === "WAITING_FOR_SELLER_RESPONSE" || isMissed(r)) ? dueWords(r.due) : null;
          return (
            <li key={r.id}>
              <Link href={`/case/${r.id}`} prefetch={false} className={`sheet ${styles.card}`} data-mine={r.mine}>
                <span className={styles.cardTop}>
                  <span className="bates">{r.id}</span>
                  <span>{usd(r.amount)}</span>
                </span>
                <strong>
                  {reasonLabel(r.reason)}
                  {r.buyer ? `, ${r.buyer}` : ""}
                </strong>
                <span className={styles.cardMeta}>
                  <span className={styles.status} data-where={isMissed(r) ? "lapsed" : r.where}>
                    {label(r)}
                  </span>
                  {call && <span>{call}</span>}
                  {due && !due.missed && <span>{due.days === 0 ? "Due today" : `${due.days} day${due.days === 1 ? "" : "s"} left`}</span>}
                </span>
              </Link>
            </li>
          );
        })}
        {shown.length === 0 && <li className={styles.muted}>No cases yet. Open one and it lands here.</li>}
      </ol>
      <div className={`sheet ${styles.grid}`} data-painted={painted}>
        {!painted && <PaperRows rows={shown} />}
        <div className={styles.gridLayer}>
          <AgGridReact<DeskRow>
            theme={theme}
            rowData={shown}
            columnDefs={cols}
            quickFilterText={quick}
            getRowId={(p) => p.data.id}
            onFirstDataRendered={() => setPainted(true)}
            onGridReady={(e) => {
              if (!e.api.getDisplayedRowCount()) setPainted(true);
            }}
            onRowClicked={(e) => {
              // The case id is a link of its own; a click anywhere else on the row opens the case too.
              if ((e.event?.target as HTMLElement | null)?.closest?.("a")) return;
              if (e.data) router.push(`/case/${e.data.id}`);
            }}
            rowClass={styles.row}
            getRowClass={(p: RowClassParams<DeskRow>) => (p.data?.mine ? styles.mine : undefined)}
            domLayout="autoHeight"
            suppressCellFocus
            tooltipShowDelay={300}
            overlayNoRowsTemplate="No cases yet. Open one and it lands here."
            defaultColDef={{ sortable: true, resizable: true }}
          />
        </div>
      </div>
      {missed.length > 0 && (
        <details className={`sheet ${styles.missedBox}`}>
          <summary>
            <span className={styles.missedTitle}>
              Missed PayPal&apos;s deadline <span className={styles.missedCount}>{missed.length}</span>
            </span>
            <em>Left unanswered on purpose, so the desk shows what a missed deadline looks like. The sandbox never closes these on its own.</em>
          </summary>
          <ul>
            {missed.map((r) => (
              <li key={r.id}>
                <Link href={`/case/${r.id}`} prefetch={false} className={`bates ${styles.caseLink}`}>
                  {r.id}
                </Link>
                <span>
                  {reasonLabel(r.reason)}
                  {r.buyer ? `, ${r.buyer}` : ""}, {usd(r.amount)}
                </span>
                <span className={styles.missed}>{r.due ? dueWords(r.due).text : "Missed"}</span>
                <span className={styles.muted}>{r.recommendation ? "Argued, never filed" : "Never argued"}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * The desk's rows as plain paper rows, server-rendered, for the seconds before AG Grid's script runs: the same
 * cases, live deadlines first, at the grid's own row height, so the page neither sits blank nor jumps much
 * when the grid takes over.
 */
function PaperRows({ rows }: { rows: DeskRow[] }) {
  const rank = (r: DeskRow) => (r.due && r.status === "WAITING_FOR_SELLER_RESPONSE" ? 0 : 1);
  const sorted = [...rows].sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? (a.due ?? "").localeCompare(b.due ?? "") : 0));
  return (
    <div className={styles.paperRows} aria-busy="true">
      <div className={styles.paperHead} aria-hidden="true">
        <span>Case</span>
        <span>Reason</span>
        <span>Amount</span>
        <span>Where it stands</span>
        <span>Call · evidence balance</span>
        <span>Filed</span>
      </div>
      {sorted.map((r) => (
        <div key={r.id} className={styles.paperRow}>
          <Link href={`/case/${r.id}`} prefetch={false} className={`bates ${styles.caseLink}`}>
            {r.id}
          </Link>
          <span>{reasonLabel(r.reason)}</span>
          <span>{usd(r.amount)}</span>
          <span className={styles.status} data-where={r.where}>
            {label(r)}
          </span>
          <span>{callWords(r) ?? "Not argued"}</span>
          <span>{shortFiled(r)}</span>
        </div>
      ))}
    </div>
  );
}
