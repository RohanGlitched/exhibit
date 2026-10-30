import { test } from "node:test";
import assert from "node:assert/strict";
import type { ColDef, IRowNode } from "ag-grid-community";
import { gridLicenceProblem, pickGridLicence, readLicence } from "../lib/ag-licence.ts";
import {
  GROUP_COL,
  REASON_COL,
  STAKE_COL,
  chartFilter,
  chartReason,
  detailHeadWords,
  enterpriseColumns,
  enterpriseOptions,
  groupComparator,
  groupLabel,
  groupOrder,
  isMaster,
  rowGroupCols,
  sentenceGridOptions,
  sentenceRows,
  sentencesFor,
  stakeByReason,
  stakeChartParams,
  stakeOf,
  stakeValue,
  type DetailClasses,
  type SentenceRow,
} from "../components/desk/enterprise-config.ts";
import { arguedBy, groupKey, sentenceWord } from "../components/desk/rows.ts";
import { deskTotals } from "../lib/desk-counts.ts";
import { sentenceState } from "../lib/cases/sentence-state.ts";
import type { DeskRow } from "../lib/desk.ts";
import type { BriefSentence, Exhibit } from "../lib/cases/types.ts";

const NOW = Date.parse("2026-10-30T12:00:00Z");

// Keys shaped like AG's (bracketed parts, a base64 expiry, a 32-character checksum). The checksums are made up:
// these only exercise which key the desk would hand to AG Grid, whose own check (LicenseManager) runs later.
const SUM = "0123456789abcdef0123456789abcdef";
const exp = (iso: string) => btoa(String(Date.parse(iso)));
const key = (parts: string[], until: string) => `${parts.map((p) => `[${p}]`).join("_")}_Exhibit_test_key_{${until}}_${exp(until)}${SUM}`;
const GRID = key(["v3", "01"], "2027-01-01T00:00:00Z");
const BOTH = key(["v3", "0102"], "2027-01-01T00:00:00Z");
const STUDIO = key(["TRIAL", "v3", "03C"], "2026-12-01T00:00:00Z");
const GRID_TRIAL = key(["TRIAL", "v3", "01"], "2026-12-01T00:00:00Z");
const GRID_TRIAL_OVER = key(["TRIAL", "v3", "01"], "2026-10-01T00:00:00Z");
const LEGACY = `Exhibit_legacy_key_${exp("2027-01-01T00:00:00Z")}${SUM}`;

test("licence: no key leaves the desk on AG Grid Community", () => {
  assert.equal(pickGridLicence({}, NOW), null);
  assert.equal(pickGridLicence({ grid: "", studio: "  " }, NOW), null);
  assert.equal(gridLicenceProblem(undefined, NOW), "no key");
});

test("licence: a Grid or Grid-and-Charts key is used, the grid variable first", () => {
  assert.deepEqual(pickGridLicence({ grid: GRID }, NOW), { key: GRID, from: "NEXT_PUBLIC_AG_GRID_LICENSE_KEY", trial: false, expires: "2027-01-01" });
  assert.equal(pickGridLicence({ grid: BOTH }, NOW)?.key, BOTH);
  assert.equal(pickGridLicence({ grid: GRID, studio: BOTH }, NOW)?.from, "NEXT_PUBLIC_AG_GRID_LICENSE_KEY");
  assert.equal(pickGridLicence({ grid: ` ${GRID}\n` }, NOW)?.key, GRID, "whitespace pasted around the key is dropped");
});

test("licence: an AG Studio key is not one AG Grid takes, so the grid stays Community with only that key", () => {
  assert.equal(readLicence(STUDIO)?.type, "STUDIO-PRO-AI");
  assert.match(gridLicenceProblem(STUDIO, NOW) ?? "", /STUDIO-PRO-AI key/);
  assert.equal(pickGridLicence({ studio: STUDIO }, NOW), null);
  // The Studio variable is used when it holds a key AG Grid does take.
  assert.equal(pickGridLicence({ studio: GRID }, NOW)?.from, "NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY");
  // A Studio key in the grid variable falls through to a usable key in the Studio one.
  assert.equal(pickGridLicence({ grid: STUDIO, studio: BOTH }, NOW)?.key, BOTH);
});

test("licence: a trial is used until its date, then the desk goes back to Community instead of AG's watermark", () => {
  const t = pickGridLicence({ grid: GRID_TRIAL }, NOW);
  assert.equal(t?.trial, true);
  assert.equal(t?.expires, "2026-12-01");
  assert.equal(pickGridLicence({ grid: GRID_TRIAL }, Date.parse("2026-12-02T00:00:00Z")), null);
  assert.match(gridLicenceProblem(GRID_TRIAL_OVER, NOW) ?? "", /trial that ended 2026-10-01/);
});

test("licence: AG's older untyped keys pass the type check; garbage and AG's documentation key do not", () => {
  assert.equal(readLicence(LEGACY)?.version, "legacy");
  assert.equal(pickGridLicence({ grid: LEGACY }, NOW)?.key, LEGACY);
  assert.equal(pickGridLicence({ grid: "not-a-key" }, NOW), null);
  assert.equal(pickGridLicence({ grid: key(["v3"], "2027-01-01T00:00:00Z") }, NOW), null, "a v3 key must say its type");
  assert.equal(pickGridLicence({ grid: `For_Trialing_ag-Grid_Only-${GRID}` }, NOW), null);
});

const row = (id: string, extra: Partial<DeskRow> = {}): DeskRow => ({
  id,
  reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  amount: 100,
  currency: "USD",
  status: "UNDER_REVIEW",
  stage: "CHARGEBACK",
  where: "filed",
  whereLine: "",
  decidedBy: null,
  askedFor: null,
  due: null,
  opened: "2026-10-29T10:00:00.000Z",
  updated: "2026-10-29T10:00:00.000Z",
  buyer: "Ada Park",
  story: null,
  storyId: null,
  tag: null,
  recommendation: "fight",
  odds: 90,
  engine: "model",
  struck: 0,
  withdrawn: 0,
  checks: 3,
  sentences: 4,
  conceded: false,
  late: false,
  filed: "Filed the response (4 sentences)",
  filedAt: "2026-10-29T11:00:00.000Z",
  outcome: null,
  mine: false,
  pooled: false,
  retired: false,
  source: "exhibit",
  ...extra,
});

const ROWS = [
  row("A", { amount: 120 }),
  row("B", { where: "waiting", status: "WAITING_FOR_SELLER_RESPONSE", due: "2026-11-05T00:00:00Z", amount: 80, reason: "UNAUTHORISED", filed: null }),
  row("C", { where: "open", amount: 45.5, reason: "UNAUTHORISED" }),
  row("D", { where: "won", decidedBy: "requested", status: "RESOLVED", amount: 300 }),
  row("E", { where: "refunded", decidedBy: "seller", amount: 60, reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", sentences: null }),
];

test("chart: money at stake by reason is the toolbar's at-stake figure, split by reason", () => {
  assert.deepEqual(stakeByReason(ROWS, NOW), [
    { reason: "Unauthorised", atStake: 125.5, cases: 2 },
    { reason: "Not received", atStake: 120, cases: 1 },
  ]);
  const total = stakeByReason(ROWS, NOW).reduce((n, r) => n + r.atStake, 0);
  assert.equal(total, deskTotals(ROWS).atStake);
  // A deadline that passed with no answer is not money in play.
  assert.equal(stakeOf(row("M", { where: "waiting", status: "WAITING_FOR_SELLER_RESPONSE", due: "2026-10-20T00:00:00Z" }), NOW), 0);
});

test("chart: a group row joins its first case's bar and adds no money to it", () => {
  const leaf = { data: ROWS[1] } as IRowNode<DeskRow>;
  const group = { data: undefined, allLeafChildren: [leaf] } as unknown as IRowNode<DeskRow>;
  assert.equal(chartReason(leaf), "Unauthorised");
  assert.equal(chartReason(group), "Unauthorised");
  assert.equal(stakeValue(undefined), undefined);
  assert.equal(stakeValue(ROWS[3], NOW), 0, "a decided case is charted as nothing at stake");
  assert.equal(chartReason(null), undefined);
});

test("chart: a cross-filter bar chart of the hidden reason and stake columns, summed, drawn into the page's slot", () => {
  const box = {} as HTMLElement;
  const p = stakeChartParams(box);
  assert.equal(p.chartType, "bar");
  assert.deepEqual(p.cellRange.columns, [REASON_COL, STAKE_COL]);
  assert.equal(p.aggFunc, "sum");
  assert.equal(p.chartContainer, box);
  assert.equal(p.suppressChartRanges, true);
  assert.deepEqual(chartFilter({ [REASON_COL]: { filterType: "set", values: ["Unauthorised"] } }), ["Unauthorised"]);
  assert.equal(chartFilter({}), null);
  assert.equal(chartFilter(null), null);
});

const BASE: ColDef<DeskRow>[] = [
  { colId: "expand", cellRenderer: "old" },
  { field: "id", headerName: "Case" },
  { field: "amount", headerName: "Amount" },
];

test("columns: the desk's own columns, the enterprise expander, summed amounts, and hidden group and chart columns", () => {
  const cols = enterpriseColumns(BASE, { expand: "new" });
  assert.equal(cols[0].cellRenderer, "new");
  assert.equal(cols[2].aggFunc, "sum");
  for (const c of cols.slice(0, 3)) assert.equal(c.chartDataType, "excluded");
  const by = (id: string) => cols.find((c) => c.colId === id)!;
  assert.equal(by(REASON_COL).chartDataType, "category");
  assert.equal(by(REASON_COL).filter, "agSetColumnFilter");
  assert.equal(by(STAKE_COL).chartDataType, "series");
  for (const id of [GROUP_COL.stage, GROUP_COL.decided, REASON_COL, STAKE_COL]) assert.equal(by(id).hide, true, id);
  // The group columns hold the same keys the Community grid's hand-built groups use.
  const get = (id: string, data: DeskRow) => (by(id).valueGetter as (p: unknown) => unknown)({ data, node: { data } });
  assert.equal(get(GROUP_COL.stage, ROWS[1]), groupKey(ROWS[1], "stage"));
  assert.equal(get(GROUP_COL.decided, ROWS[3]), "requested");
  // The base columns are not changed in place.
  assert.equal(BASE[0].cellRenderer, "old");
  assert.deepEqual(rowGroupCols("none"), []);
  assert.deepEqual(rowGroupCols("stage"), [GROUP_COL.stage]);
  assert.deepEqual(rowGroupCols("decided"), [GROUP_COL.decided]);
});

test("grouping: groups in the desk's reading order, named as the Community grid names them", () => {
  assert.equal(groupLabel("stage", "waiting"), "Your move");
  assert.equal(groupLabel("decided", "sandbox"), "Closed by the sandbox on its own");
  assert.ok(groupOrder("stage", "waiting") < groupOrder("stage", "filed"));
  assert.ok(groupOrder("stage", "filed") < groupOrder("stage", "won"));
  const node = (key: string) => ({ key, rowGroupColumn: { getColId: () => GROUP_COL.stage } }) as unknown as IRowNode<DeskRow>;
  const keys = ["refunded", "won", "waiting", "filed"].map(node).sort((a, b) => groupComparator({ nodeA: a, nodeB: b }));
  assert.deepEqual(
    keys.map((n) => n.key),
    ["waiting", "filed", "won", "refunded"],
  );
});

const CLS: DetailClasses & { groupRow: string; detailRow: string; mine: string } = {
  detail: "d",
  detailHead: "dh",
  detailOpen: "do",
  detailGrid: "dg",
  sentenceStruck: "ss",
  sentenceWithdrawn: "sw",
  wordGood: "wg",
  wordBad: "wb",
  wordFaint: "wf",
  groupRow: "gr",
  detailRow: "dr",
  mine: "m",
};

const EXHIBITS: Exhibit[] = [{ id: "A", title: "Order", facts: [], lines: ["Tracking 9400 delivered"] } as unknown as Exhibit];
const SENTENCES: BriefSentence[] = [
  { text: "Delivered on 3 Oct 2026.", cites: ["A"], kept: true, checked: ["3 Oct 2026"] },
  { text: "The buyer signed.", cites: ["A"], kept: false, why: "no signature in Exhibit A" },
  { text: "The parcel was tracked.", cites: ["A"], kept: true, unverified: true },
];

test("master/detail: each sentence of the brief is a detail-grid row with the checker's word", () => {
  const rows = sentenceRows({ sentences: SENTENCES, exhibits: EXHIBITS });
  assert.deepEqual(
    rows.map((r) => [r.n, r.kind, r.word, r.cites]),
    [
      [1, "checked", "Checked: 3 Oct 2026", "A"],
      [2, "struck", "Struck: no signature in Exhibit A", "A"],
      [3, "unverified", "Unverified", "A"],
    ],
  );
  // The same words as the Community grid's opened brief.
  for (const [i, s] of SENTENCES.entries()) assert.equal(rows[i].word, sentenceWord(s, sentenceState(s, EXHIBITS)));
});

test("master/detail: the detail row says what the brief is; its grid has a row per sentence, as tall as its text", async () => {
  assert.equal(detailHeadWords({ sentences: 1, engine: "rules" }), "The brief, 1 sentence, argued by the rules engine");
  assert.equal(detailHeadWords({ sentences: 4, engine: null }), "The brief, 4 sentences, read back from PayPal");
  assert.equal(arguedBy("model"), "argued by the model");
  const g = sentenceGridOptions({} as never, CLS);
  assert.equal(g.domLayout, "autoHeight");
  assert.deepEqual(
    g.columnDefs?.map((c) => (c as ColDef).field),
    ["n", "text", "cites", "word"],
  );
  const text = g.columnDefs?.[1] as ColDef<SentenceRow>;
  assert.equal(text.wrapText, true);
  assert.equal(text.autoHeight, true);
  const rules = text.cellClassRules as Record<string, (p: { data: Partial<SentenceRow> }) => boolean>;
  assert.equal(rules.ss({ data: { kind: "struck" } }), true);
  assert.equal(rules.ss({ data: { kind: "checked" } }), false);
  const asked: string[] = [];
  const load = async (id: string) => {
    asked.push(id);
    if (id === "NONE") throw new Error("No brief on record for this case.");
    return { sentences: SENTENCES, exhibits: EXHIBITS };
  };
  assert.equal((await sentencesFor(load, "A")).length, 3);
  assert.deepEqual(await sentencesFor(load, "NONE"), [], "a brief that can't be read leaves an empty detail grid, not an error");
  assert.deepEqual(asked, ["A", "NONE"]);
});

test("options: grouping rows open, briefs shut until asked, master/detail for cases with a brief, charts on", () => {
  const detail = () => null;
  const o = enterpriseOptions({
    theme: {} as never,
    classes: CLS,
    groupInner: () => null,
    detail,
    loadBrief: async () => ({ sentences: SENTENCES, exhibits: EXHIBITS }),
  });
  assert.equal(o.groupDisplayType, "groupRows");
  assert.equal(o.groupDefaultExpanded, -1);
  assert.equal(o.masterDefaultExpanded, 0, "without this every brief opens with its group");
  assert.equal(o.masterDetail, true);
  assert.equal(o.detailRowAutoHeight, true);
  assert.equal(o.detailCellRenderer, detail);
  assert.equal(o.enableCharts, true);
  assert.equal(isMaster(ROWS[0]), true);
  assert.equal(isMaster(ROWS[4]), false, "a case with no brief on record has nothing to open");
  const cls = o.getRowClass as (p: unknown) => string | undefined;
  assert.equal(cls({ node: { group: true }, data: undefined }), "gr");
  assert.equal(cls({ node: { detail: true }, data: ROWS[0] }), "dr");
  assert.equal(cls({ node: {}, data: row("X", { mine: true }) }), "m");
});
