"use client";

import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams, type RowClassParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { DeskRow } from "@/lib/desk";
import { STATUSES, daysUntil, reasonLabel, shortDay, usd } from "@/lib/format";
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

function Due({ value, data }: ICellRendererParams<DeskRow, string | null>) {
  if (!value || data?.status === "RESOLVED") return <span className={styles.muted}>—</span>;
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

function Status({ value, data }: ICellRendererParams<DeskRow, string>) {
  return (
    <span className={styles.status} data-status={value}>
      {data?.pooled ? "In the house pool" : STATUSES[value ?? ""] ?? value}
    </span>
  );
}

export default function DeskGrid({ initial }: { initial: DeskRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [mineOnly, setMineOnly] = useState(false);
  const [quick, setQuick] = useState("");

  useEffect(() => {
    const t = setInterval(async () => {
      const r = await fetch("/api/cases", { cache: "no-store" }).catch(() => null);
      if (r?.ok) setRows(((await r.json()) as { rows: DeskRow[] }).rows);
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  const cols = useMemo<ColDef<DeskRow>[]>(
    () => [
      { field: "id", headerName: "Case", width: 190, cellClass: "bates", pinned: "left" },
      { field: "reason", headerName: "Reason", width: 160, valueFormatter: (p) => reasonLabel(p.value ?? "") },
      { field: "amount", headerName: "Amount", width: 110, type: "rightAligned", valueFormatter: (p) => usd(p.value ?? 0) },
      { field: "buyer", headerName: "Buyer", width: 160, valueFormatter: (p) => p.value ?? "—" },
      { field: "status", headerName: "Status", width: 170, cellRenderer: Status },
      { field: "due", headerName: "Respond in", width: 140, cellRenderer: Due, sort: "asc", comparator: (a, b) => (a ?? "9").localeCompare(b ?? "9") },
      { field: "odds", headerName: "Exhibit's call", width: 190, cellRenderer: Odds },
      { field: "filed", headerName: "Filed", flex: 1, minWidth: 220, valueFormatter: (p) => p.value ?? "Nothing yet" },
      { field: "opened", headerName: "Opened", width: 110, valueFormatter: (p) => (p.value ? shortDay(p.value) : "") },
    ],
    [],
  );

  const shown = mineOnly ? rows.filter((r) => r.mine) : rows;
  const open = shown.filter((r) => r.status === "WAITING_FOR_SELLER_RESPONSE").length;
  const atStake = shown.filter((r) => r.status !== "RESOLVED").reduce((s, r) => s + r.amount, 0);

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <p className={styles.counts}>
          <strong>{open}</strong> waiting on the seller, <strong>{usd(atStake)}</strong> at stake
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
        </div>
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
                <span className={styles.status} data-status={r.status}>
                  {r.pooled ? "In the house pool" : STATUSES[r.status] ?? r.status}
                </span>
                {r.recommendation && (
                  <span>
                    {REC[r.recommendation]}, {r.odds}%
                  </span>
                )}
                {r.due && r.status !== "RESOLVED" && <span>{Math.max(0, daysUntil(r.due) ?? 0)} days left</span>}
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
