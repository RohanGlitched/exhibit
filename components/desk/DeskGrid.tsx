"use client";

import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type GridApi,
  type ICellRendererParams,
  type IRowNode,
  type PostSortRowsParams,
  type RowClassParams,
  type RowHeightParams,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DeskRow } from "@/lib/desk";
import { deskTotals } from "@/lib/desk-counts";
import type { BriefSentence, Exhibit } from "@/lib/cases/types";
import { sentenceState } from "@/lib/cases/sentence-state";
import { reasonLabel, usd, utcShortDay } from "@/lib/format";
import {
  DECIDED_TINY,
  arrange,
  callCell,
  callWords,
  dueWords,
  isLive,
  isMissed,
  lateWord,
  matchesQuick,
  shortFiled,
  stakeByDay,
  type DetailRow,
  type GroupBy,
  type GroupHead,
} from "./rows";
import DeskStrip from "./DeskStrip";
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

const label = (r: DeskRow) => (r.pooled ? "In the house pool" : isMissed(r) ? "Missed" : (lateWord(r) ?? WHERE[r.where] ?? r.status));

/** Rows the grid holds: cases, and the full-width rows it adds (group headers and opened briefs). */
type GridRow = DeskRow | GroupHead | DetailRow;
const kindOf = (d: unknown) => (d as { kind?: string } | null | undefined)?.kind;

const GROUP_BY: { id: GroupBy; label: string }[] = [
  { id: "none", label: "None" },
  { id: "stage", label: "Where it stands" },
  { id: "decided", label: "Who decided" },
];

interface GridContext {
  open: ReadonlySet<string>;
  toggle: (id: string) => void;
}

/** The +/- at the head of a row whose brief can be opened under it. */
function Expand(p: ICellRendererParams<DeskRow>) {
  const r = p.data;
  if (!r || kindOf(r) || r.sentences == null) return null;
  const ctx = p.context as GridContext;
  const open = ctx.open.has(r.id);
  return (
    <button
      type="button"
      className={styles.expand}
      aria-expanded={open}
      aria-label={`${open ? "Hide" : "Show"} the brief for ${r.id}`}
      title={open ? "Hide the brief" : "Show the brief, sentence by sentence"}
      onClick={(e) => {
        e.stopPropagation();
        ctx.toggle(r.id);
      }}
    >
      {open ? "\u2212" : "+"}
    </button>
  );
}

/** A group's header row: its name, how many cases, how much money. */
function GroupHeader(p: { data: GroupHead }) {
  const g = p.data;
  return (
    <div className={styles.groupHead}>
      <strong>{g.label}</strong>
      <span>
        {g.count} case{g.count === 1 ? "" : "s"}, {usd(g.amount)}
      </span>
    </div>
  );
}

interface LoadedBrief {
  sentences: BriefSentence[];
  exhibits: Exhibit[];
  engine: string;
}

// Briefs read once per page view; row heights kept so a re-sort doesn't make an opened row jump.
const briefs = new Map<string, Promise<LoadedBrief>>();
const heights = new Map<string, number>();

function loadBrief(id: string): Promise<LoadedBrief> {
  let p = briefs.get(id);
  if (!p) {
    p = fetch(`/api/cases/${id}`)
      .then(async (r) => {
        const j = (await r.json()) as { brief?: { sentences: BriefSentence[]; engine: string } | null; exhibits?: Exhibit[]; error?: string };
        if (!r.ok || !j.brief) throw new Error(j.error ?? "No brief on record for this case.");
        return { sentences: j.brief.sentences, exhibits: j.exhibits ?? [], engine: j.brief.engine };
      })
      .catch((e) => {
        briefs.delete(id);
        throw e;
      });
    briefs.set(id, p);
  }
  return p;
}

const BADGE: Record<string, string> = { struck: "Struck", withdrawn: "Withdrawn at the hearing", unverified: "Unverified", kept: "Kept" };

/**
 * A case's brief opened under its row: every sentence with the exhibits it cites (as Bates marks) and what the
 * checker made of it. Read from the case on first open; the row grows to fit what it holds.
 */
function BriefDetail(p: ICellRendererParams<DetailRow>) {
  const id = (p.data as DetailRow).caseId;
  const [brief, setBrief] = useState<LoadedBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    loadBrief(id)
      .then((b) => live && setBrief(b))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [id]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const h = Math.ceil(el.getBoundingClientRect().height) + 1;
      if (heights.get(id) === h) return;
      heights.set(id, h);
      p.node.setRowHeight(h);
      p.api.onRowHeightChanged();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, brief, error, p.node, p.api]);
  const title = (c: string) => brief?.exhibits.find((e) => e.id === c)?.title;
  const by = brief ? (brief.engine === "model" ? "argued by the model" : brief.engine === "rules" ? "argued by the rules engine" : "read back from PayPal") : "";
  return (
    <div className={styles.detail} ref={box}>
      <p className={styles.detailHead}>
        <span className="bates">{id}</span>
        <span>{brief ? `The brief, ${brief.sentences.length} sentences, ${by}` : "The brief"}</span>
        <Link href={`/case/${id}`} prefetch={false} className={styles.detailOpen}>
          Open the case
        </Link>
      </p>
      {error ? (
        <p className={styles.muted}>{error}</p>
      ) : !brief ? (
        <p className={styles.detailWait}>Reading the brief from the case…</p>
      ) : (
        <ol className={styles.sentences}>
          {brief.sentences.map((s, i) => {
            const st = sentenceState(s, brief.exhibits);
            const badge =
              st.kind === "checked"
                ? `Checked: ${(s.checked ?? []).join(", ")}`
                : st.kind === "quoted"
                  ? `Quote matched in Exhibit ${st.exhibit ?? s.cites.join(" or ")}`
                  : st.kind === "struck" && s.why
                    ? `Struck: ${s.why}`
                    : BADGE[st.kind];
            return (
              <li key={i} data-kind={st.kind}>
                <span className={styles.sNum}>{i + 1}</span>
                <span className={styles.sText}>{s.text}</span>
                <span className={styles.sMarks}>
                  {s.cites.map((c) => (
                    <abbr key={c} title={title(c) ? `Exhibit ${c}: ${title(c)}` : `Exhibit ${c}`}>
                      {c}
                    </abbr>
                  ))}
                </span>
                <span className={styles.sState}>{badge}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** Money opened per day over the last two weeks, with the part of it still at stake: a sparkline beside the counts. */
function StakeSpark({ rows }: { rows: DeskRow[] }) {
  const [now] = useState(() => Date.now());
  const days = stakeByDay(rows, now, 14);
  const max = Math.max(1, ...days.map((d) => d.opened));
  const W = 9;
  const H = 30;
  const stake = days.reduce((n, d) => n + d.atStake, 0);
  const line = (d: (typeof days)[number]) => `${utcShortDay(`${d.day}T12:00:00Z`)}: ${usd(d.opened)} opened, ${usd(d.atStake)} still at stake`;
  const words = days.filter((d) => d.opened > 0).map(line);
  return (
    <figure className={styles.spark}>
      <svg
        width={days.length * W}
        height={H}
        viewBox={`0 0 ${days.length * W} ${H}`}
        role="img"
        aria-label={`Disputed money opened per day, last 14 days (UTC). ${words.join("; ") || "Nothing opened."}`}
      >
        {days.map((d, i) => {
          const h = d.opened ? Math.max(2, Math.round((d.opened / max) * (H - 2))) : 1;
          const k = d.atStake ? Math.max(2, Math.round((d.atStake / max) * (H - 2))) : 0;
          return (
            <g key={d.day}>
              <title>{line(d)}</title>
              <rect x={i * W} y={H - h} width={W - 3} height={h} className={d.opened ? styles.sparkOpened : styles.sparkNone} />
              {k > 0 && <rect x={i * W} y={H - k} width={W - 3} height={k} className={styles.sparkStake} />}
            </g>
          );
        })}
      </svg>
      <figcaption>
        Disputed money opened per day, last 14 days (UTC). <span className={styles.sparkKey}>Blue</span> is still at stake: {usd(stake)} of it.
      </figcaption>
    </figure>
  );
}

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

/** The reason, with a small tag for the seller's own lane and for how an agent story's purchase was made. */
function Reason({ value, data }: ICellRendererParams<DeskRow, string>) {
  return (
    <span className={styles.reason}>
      {reasonLabel(value ?? "")}
      {data?.tag && <span className={styles.tag} data-tag={data.tag.startsWith("Script,") ? "script" : "live"}>{data.tag}</span>}
    </span>
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

export default function DeskGrid({ initial, at: initialAt }: { initial: DeskRow[]; at: string }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [at, setAt] = useState(initialAt);
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const api = useRef<GridApi | null>(null);
  // Read by the grid's sort callback, which keeps groups and opened briefs together after every sort.
  const arrangeBy = useRef<{ by: GroupBy; open: ReadonlySet<string> }>({ by: groupBy, open });
  arrangeBy.current = { by: groupBy, open };
  const toggle = useCallback((id: string) => {
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const context = useMemo<GridContext>(() => ({ open, toggle }), [open, toggle]);
  useEffect(() => {
    api.current?.refreshCells({ columns: ["expand"], force: true });
  }, [open]);
  const [mineOnly, setMineOnly] = useState(false);
  const [quick, setQuick] = useState("");
  const [filter, setFilter] = useState("all");
  const [probes, setProbes] = useState(false);
  // AG Grid paints only once its script has run; until then the same rows show as plain paper rows.
  const [painted, setPainted] = useState(false);

  useEffect(() => {
    const t = setInterval(async () => {
      const r = await fetch("/api/cases", { cache: "no-store" }).catch(() => null);
      if (!r?.ok) return;
      const j = (await r.json()) as { rows: DeskRow[]; at?: string };
      setRows(j.rows);
      if (j.at) setAt(j.at);
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  // Fixed widths that fit the 1,200 px desk with every column whole ("Evidence + PDF", "Fight sandbox closed it");
  // reason and buyer take what is left.
  const cols = useMemo<ColDef<DeskRow>[]>(
    () => [
      {
        colId: "expand",
        headerName: "",
        headerTooltip: "Show a case's brief under its row",
        width: 44,
        pinned: "left",
        sortable: false,
        resizable: false,
        cellRenderer: Expand,
        cellClass: styles.expandCell,
      },
      { field: "id", headerName: "Case", width: 196, cellRenderer: CaseId, pinned: "left" },
      { field: "reason", headerName: "Reason", flex: 1, minWidth: 128, valueFormatter: (p) => reasonLabel(p.value ?? ""), cellRenderer: Reason },
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
      { field: "odds", headerName: "Call · evidence balance", headerTooltip: BALANCE_TIP, width: 176, cellRenderer: Call },
      {
        field: "filed",
        headerName: "Filed",
        width: 124,
        tooltipValueGetter: (p) => p.data?.filed ?? null,
        valueGetter: (p) => (p.data ? shortFiled(p.data) : ""),
      },
      { field: "opened", headerName: "Opened", width: 70, valueFormatter: (p) => (p.value ? utcShortDay(p.value) : "") },
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
  const shown = live.filter((r) => (!mineOnly || r.mine) && (!test || test(r)) && matchesQuick(r, quick, reasonLabel));
  const waitingCount = live.filter((r) => isLive(r)).length;
  const missedCount = missed.length;
  // The one count (lib/desk-counts.ts): the strip, this line and the home page's figures read the same snapshot.
  // A missed deadline is not money still in play: PayPal decides those for the buyer.
  const totals = deskTotals(rows);
  const atStake = totals.atStake;
  // Phone cards and the grid's first paint follow the grid's default order: live deadlines first, soonest first.
  const rank = (r: DeskRow) => (r.due && !isMissed(r) && r.status === "WAITING_FOR_SELLER_RESPONSE" ? 0 : 1);
  const ordered = [...shown].sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? (a.due ?? "").localeCompare(b.due ?? "") : 0));
  const key = ordered.map((r) => `${r.id}:${r.updated}:${r.where}`).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const gridRows = useMemo(() => arrange(ordered, groupBy, open) as GridRow[], [key, groupBy, open]);
  const cardRows = arrange(ordered, groupBy, new Set<string>());

  return (
    <div className={styles.wrap}>
      <DeskStrip c={totals} at={at} />
      <div className={styles.toolbar}>
        <p className={styles.counts}>
          <strong>{waitingCount}</strong> waiting on the seller, <strong>{usd(atStake)}</strong> at stake
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
      <StakeSpark rows={desk} />
      <div className={styles.filters} role="group" aria-label="Show cases">
        {FILTERS.map((f) => {
          const n = f.test ? live.filter(f.test).length : live.length;
          return (
            <button key={f.id} type="button" className={styles.chip} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label} <span>{n}</span>
            </button>
          );
        })}
        <span className={styles.groupBy}>
          <span className={styles.groupLabel} id="desk-group-by">
            Group
          </span>
          <span className={styles.segments} role="group" aria-labelledby="desk-group-by">
            {GROUP_BY.map((g) => (
              <button key={g.id} type="button" className={styles.segment} aria-pressed={groupBy === g.id} onClick={() => setGroupBy(g.id)}>
                {g.label}
              </button>
            ))}
          </span>
        </span>
      </div>
      <ol className={styles.cards}>
        {cardRows.map((row) => {
          if (kindOf(row) === "group") {
            const g = row as GroupHead;
            return (
              <li key={g.id} className={styles.cardGroup}>
                <strong>{g.label}</strong>
                <span>
                  {g.count} case{g.count === 1 ? "" : "s"}, {usd(g.amount)}
                </span>
              </li>
            );
          }
          const r = row as DeskRow;
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
                {r.tag && <span className={styles.tag} data-tag={r.tag.startsWith("Script,") ? "script" : "live"}>{r.tag}</span>}
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
        {!painted && <PaperRows rows={ordered} />}
        <div className={styles.gridLayer}>
          <AgGridReact<DeskRow>
            theme={theme}
            rowData={gridRows as DeskRow[]}
            columnDefs={cols}
            context={context}
            getRowId={(p) => p.data.id}
            // Group headers and opened briefs are full-width rows (AG Grid Community); after every sort each group
            // stays together under its header and each brief under its case.
            isFullWidthRow={(p) => Boolean(kindOf(p.rowNode.data))}
            fullWidthCellRenderer={FullWidth}
            getRowHeight={(p: RowHeightParams<DeskRow>) => {
              const k = kindOf(p.data);
              if (k === "group") return 44;
              if (k === "detail") return heights.get((p.data as unknown as DetailRow).caseId) ?? 120;
              return undefined;
            }}
            postSortRows={(p: PostSortRowsParams<DeskRow>) => {
              const { by, open: opened } = arrangeBy.current;
              const byId = new Map(p.nodes.map((n) => [n.id, n]));
              const cases = p.nodes.filter((n) => !kindOf(n.data)).map((n) => n.data as DeskRow);
              const order = arrange(cases, by, opened)
                .map((r) => byId.get(r.id))
                .filter((n): n is IRowNode<DeskRow> => Boolean(n));
              if (order.length === p.nodes.length) p.nodes.splice(0, p.nodes.length, ...order);
            }}
            onFirstDataRendered={() => setPainted(true)}
            onGridReady={(e) => {
              api.current = e.api;
              if (!e.api.getDisplayedRowCount()) setPainted(true);
            }}
            onRowClicked={(e) => {
              // The case id is a link of its own and the +/- opens the brief; a click anywhere else on a case row opens the case.
              if ((e.event?.target as HTMLElement | null)?.closest?.("a, button")) return;
              if (e.data && !kindOf(e.data)) router.push(`/case/${e.data.id}`);
            }}
            rowClass={styles.row}
            getRowClass={(p: RowClassParams<DeskRow>) => {
              const k = kindOf(p.data);
              if (k === "group") return styles.groupRow;
              if (k === "detail") return styles.detailRow;
              return p.data?.mine ? styles.mine : undefined;
            }}
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

/** A full-width row: a group's header, or a case's brief opened under it. */
function FullWidth(p: ICellRendererParams<GridRow>) {
  return kindOf(p.data) === "group" ? <GroupHeader data={p.data as GroupHead} /> : <BriefDetail {...(p as unknown as ICellRendererParams<DetailRow>)} />;
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
