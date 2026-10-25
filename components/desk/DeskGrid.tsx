"use client";

import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams, type RowClassParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { DeskRow } from "@/lib/desk";
import type { Stage } from "@/lib/cases/derive";
import { daysUntil, reasonLabel, shortDay, usd } from "@/lib/format";
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
  cellHorizontalPadding: 14,
});

const REC: Record<string, string> = { fight: "Fight", accept: "Refund", offer: "Offer" };

const WHERE: Record<Stage, string> = {
  open: "PayPal reviewing",
  waiting: "Your move",
  lapsed: "Missed deadline",
  filed: "Filed",
  refunded: "Refunded",
  won: "Won",
  lost: "Lost",
  reviewing: "PayPal reviewing",
  other: "Other",
};

const FILTERS: { id: string; label: string; stages: Stage[] | null }[] = [
  { id: "all", label: "All", stages: null },
  { id: "waiting", label: "Your move", stages: ["waiting"] },
  { id: "reviewing", label: "PayPal reviewing", stages: ["open", "filed", "reviewing"] },
  { id: "won", label: "Won", stages: ["won"] },
  { id: "refunded", label: "Refunded", stages: ["refunded"] },
  { id: "lost", label: "Lost", stages: ["lost"] },
  { id: "lapsed", label: "Missed deadline", stages: ["lapsed"] },
];

const label = (r: DeskRow) => (r.pooled ? "In the house pool" : WHERE[r.where] ?? r.status);

function Due({ value, data }: ICellRendererParams<DeskRow, string | null>) {
  if (!value || data?.status !== "WAITING_FOR_SELLER_RESPONSE") return <span className={styles.muted}>—</span>;
  if (data.where === "lapsed") return <span className={styles.muted}>Missed</span>;
  const d = daysUntil(value) ?? 0;
  const pct = Math.max(0, Math.min(100, (d / 10) * 100));
  return (
    <span className={styles.due} data-soon={d <= 2}>
      <span className={styles.dueBar}>
        <i style={{ width: `${pct}%` }} />
      </span>
      {d <= 0 ? "Today" : `${d} d`}
    </span>
  );
}

function Odds({ value, data }: ICellRendererParams<DeskRow, number | null>) {
  if (value == null && data?.recommendation) return <b data-rec={data.recommendation}>{REC[data.recommendation]}</b>;
  if (value == null) return <span className={styles.muted}>Not argued</span>;
  return (
    <span className={styles.odds}>
      <span className={styles.oddsBar}>
        <i style={{ width: `${value}%` }} />
      </span>
      <b data-rec={data?.recommendation}>{REC[data?.recommendation ?? ""] ?? ""}</b>
      {value}%
    </span>
  );
}

function Status({ data }: ICellRendererParams<DeskRow, string>) {
  if (!data) return null;
  return (
    <span className={styles.status} data-where={data.where} title={data.whereLine}>
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

  useEffect(() => {
    const t = setInterval(async () => {
      const r = await fetch("/api/cases", { cache: "no-store" }).catch(() => null);
      if (r?.ok) setRows(((await r.json()) as { rows: DeskRow[] }).rows);
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  const cols = useMemo<ColDef<DeskRow>[]>(
    () => [
      { field: "id", headerName: "Case", width: 205, cellClass: "bates", pinned: "left" },
      { field: "reason", headerName: "Reason", width: 132, valueFormatter: (p) => reasonLabel(p.value ?? "") },
      { field: "amount", headerName: "Amount", width: 94, type: "rightAligned", valueFormatter: (p) => usd(p.value ?? 0) },
      { field: "buyer", headerName: "Buyer", width: 140, valueFormatter: (p) => p.value ?? "—" },
      { field: "where", headerName: "Where it stands", width: 136, cellRenderer: Status },
      { field: "due", headerName: "Respond in", width: 108, cellRenderer: Due, sort: "asc", comparator: (a, b) => (a ?? "9").localeCompare(b ?? "9") },
      { field: "odds", headerName: "Exhibit's call", width: 152, cellRenderer: Odds },
      {
        field: "filed",
        headerName: "Filed",
        flex: 1,
        minWidth: 150,
        tooltipValueGetter: (p) => p.data?.filed ?? null,
        valueFormatter: (p) =>
          p.data?.source === "probe" ? `Build-day API probe. ${p.value ?? ""}` : (p.value ?? (p.data?.where === "lost" ? "Nothing before the deadline" : "Nothing yet")),
      },
      { field: "opened", headerName: "Opened", width: 92, valueFormatter: (p) => (p.value ? shortDay(p.value) : "") },
    ],
    [],
  );

  // Pool cases are stock waiting for the next visitor (and retired stock never reached anyone): count them,
  // don't list them. Build-day API probes are real disputes too, listed on request.
  const pooled = rows.filter((r) => r.pooled).length;
  const retired = rows.filter((r) => r.retired).length;
  const probeCount = rows.filter((r) => r.source === "probe").length;
  const live = rows.filter((r) => !r.pooled && !r.retired && (probes || r.source !== "probe"));
  const stages = FILTERS.find((f) => f.id === filter)?.stages;
  const shown = live.filter((r) => (!mineOnly || r.mine) && (!stages || stages.includes(r.where)));
  const open = live.filter((r) => r.where === "waiting").length;
  const atStake = live.filter((r) => r.where === "waiting" || r.where === "filed" || r.where === "open").reduce((s, r) => s + r.amount, 0);

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <p className={styles.counts}>
          <strong>{open}</strong> waiting on the seller, <strong>{usd(atStake)}</strong> at stake
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
          const n = f.stages ? live.filter((r) => f.stages!.includes(r.where)).length : live.length;
          return (
            <button key={f.id} type="button" className={styles.chip} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label} <span>{n}</span>
            </button>
          );
        })}
      </div>
      <ol className={styles.cards}>
        {shown.map((r) => (
          <li key={r.id}>
            <a href={`/case/${r.id}`} className={`sheet ${styles.card}`} data-mine={r.mine}>
              <span className={styles.cardTop}>
                <span className="bates">{r.id}</span>
                <span>{usd(r.amount)}</span>
              </span>
              <strong>{reasonLabel(r.reason)}{r.buyer ? `, ${r.buyer}` : ""}</strong>
              <span className={styles.cardMeta}>
                <span className={styles.status} data-where={r.where}>
                  {label(r)}
                </span>
                {r.recommendation && (
                  <span>
                    {REC[r.recommendation]}
                    {r.odds != null ? `, ${r.odds}%` : ""}
                  </span>
                )}
                {r.due && r.where === "waiting" && <span>{Math.max(0, daysUntil(r.due) ?? 0)} days left</span>}
              </span>
            </a>
          </li>
        ))}
        {shown.length === 0 && <li className={styles.muted}>No cases yet. Open one and it lands here.</li>}
      </ol>
      <div className={`sheet ${styles.grid}`}>
        <AgGridReact<DeskRow>
          theme={theme}
          rowData={shown}
          columnDefs={cols}
          quickFilterText={quick}
          getRowId={(p) => p.data.id}
          onRowClicked={(e) => e.data && router.push(`/case/${e.data.id}`)}
          rowClass={styles.row}
          getRowClass={(p: RowClassParams<DeskRow>) => (p.data?.mine ? styles.mine : undefined)}
          domLayout="autoHeight"
          suppressCellFocus
          overlayNoRowsTemplate="No cases yet. Open one and it lands here."
          defaultColDef={{ sortable: true, resizable: true }}
        />
      </div>
    </div>
  );
}
