import type { AgDefaultRegistry, AgDefaultWidgetDefinition, AgShapeBuilder, AgWidgetFormParams, AgWidgetsConfig } from "ag-studio";
import { createWidgets, type AgWidgetDefinition } from "ag-studio-react";
import CheckerStrikes, { type CheckerStrikesWidget } from "./CheckerStrikes";
import DeadlineLadder, { type DeadlineLadderWidget } from "./DeadlineLadder";
import Ledger, { type LedgerWidget } from "./Ledger";
import StampCounts, { type StampCountsWidget } from "./StampCounts";
import { exhibitCellRenderer } from "./cells";
import { paperFormat } from "./shared";

/** Exhibit's own widgets, registered with Studio beside its built-in ones. */
export type ExhibitWidgetDefinition =
  | AgWidgetDefinition<"exhibit-deadline-ladder", DeadlineLadderWidget>
  | AgWidgetDefinition<"exhibit-ledger", LedgerWidget>
  | AgWidgetDefinition<"exhibit-checker-strikes", CheckerStrikesWidget>
  | AgWidgetDefinition<"exhibit-stamps", StampCountsWidget>;

export interface ExhibitRegistry extends Omit<AgDefaultRegistry, "widgets"> {
  widgets: readonly (ExhibitWidgetDefinition | AgDefaultWidgetDefinition)[];
}

const icon = (paths: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

// Adds a section of the widget's own options to the Setup tab of the default form.
function withSection<T>(form: T, section: { key: string; label: string; items: unknown[] }): T {
  const tabs = (form as unknown as { items: { items: unknown[] }[] }).items;
  tabs[0]?.items.push({ type: "section", ...section });
  return form;
}

const ladder: AgWidgetDefinition<"exhibit-deadline-ladder", DeadlineLadderWidget> = {
  id: "exhibit-deadline-ladder",
  label: "Deadline ladder",
  icon: icon('<path d="M6 3v18M18 3v18M6 7h12M6 12h12M6 17h12"/>'),
  dataMapping: {
    case: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, required: true, aiDescription: "The case id: one rung per case." },
    daysLeft: {
      type: "field",
      supportedRoles: ["numeric"],
      requires: { per: "dataMapping.case", cardinality: "one" },
      required: true,
      aiDescription: "Days to PayPal's deadline for each case (cases.daysLeft, aggregation min). Cases with no days left are not on the seller's move and are left off; below zero, the deadline passed and the case is listed as missed under the ladder.",
    },
    amount: { type: "field", supportedRoles: ["numeric"], requires: { per: "dataMapping.case", cardinality: "one" }, aiDescription: "Money at stake on each case (cases.amount, sum)." },
    label: { type: "field", supportedRoles: ["category"], requires: { per: "dataMapping.case", cardinality: "one" }, aiDescription: "A short label under each case id, e.g. cases.story or cases.buyer." },
  },
  form: (params: AgWidgetFormParams<DeadlineLadderWidget>) =>
    withSection(
      params.createDefaults({
        dataMappingItems: [
          { key: "case", label: "Case" },
          { key: "daysLeft", label: "Days left" },
          { key: "amount", label: "Amount" },
          { key: "label", label: "Label" },
        ],
      }),
      {
        key: "ladder",
        label: "Deadline",
        items: [
          { type: "number", id: "format.style.urgentDays", label: "Red at or under (days)", defaultValue: 2, min: 0, max: 10, step: 1 },
          { type: "number", id: "format.style.windowDays", label: "Response window (days)", defaultValue: 10, min: 1, max: 30, step: 1 },
          { type: "number", id: "format.style.maxRungs", label: "Most rungs to draw", defaultValue: 12, min: 1, max: 40, step: 1 },
        ],
      },
    ),
  formatShape: paperFormat((s: AgShapeBuilder) =>
    s.object({
      urgentDays: s.number({ description: "Rungs with this many days left or fewer are red. Default 2." }).optional(),
      windowDays: s.number({ description: "Length of PayPal's response window in days. Default 10." }).optional(),
      maxRungs: s.number({ description: "Most rungs drawn before the rest are summed up. Default 12." }).optional(),
    }) as never,
  ),
  comp: DeadlineLadder,
  defaultSize: { width: 640, height: 480 },
  minSize: { width: 300, height: 220 },
  ai: {
    label: "Deadline ladder",
    description:
      "Exhibit's deadline ladder: every case on the seller's move as a rung, soonest PayPal deadline first, each drawn as the ten-day response window with the days left filled in; two days or fewer is red. Deadlines that passed with no answer are listed apart, in grey, as missed. Clicking a rung cross-filters to that case; double-clicking opens the case.",
    usage: "Use for what is due, what will cost money soon, or which disputes need an answer first. Not for decided cases.",
    configuration: "Map case to cases.caseId, daysLeft to cases.daysLeft with aggregation min, amount to cases.amount with sum, and label to cases.story.",
  },
};

const ledger: AgWidgetDefinition<"exhibit-ledger", LedgerWidget> = {
  id: "exhibit-ledger",
  label: "Kept / refunded / lost",
  icon: icon('<path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21z"/><path d="M9 8h6M9 12h6M9 16h4"/>'),
  dataMapping: {
    kept: { type: "field", supportedRoles: ["numeric"], requires: { cardinality: "one" }, required: true, aiDescription: "Money kept by fighting and winning (cases.kept, sum)." },
    refunded: { type: "field", supportedRoles: ["numeric"], requires: { cardinality: "one" }, required: true, aiDescription: "Money refunded by accepting the claim (cases.refunded, sum)." },
    lost: { type: "field", supportedRoles: ["numeric"], requires: { cardinality: "one" }, aiDescription: "Money lost after fighting or not answering (cases.lostAmount, sum)." },
    atStake: { type: "field", supportedRoles: ["numeric"], requires: { cardinality: "one" }, aiDescription: "Money still undecided (cases.atStake, sum)." },
  },
  form: (params: AgWidgetFormParams<LedgerWidget>) =>
    withSection(
      params.createDefaults({
        dataMappingItems: [
          { key: "kept", label: "Kept" },
          { key: "refunded", label: "Refunded" },
          { key: "lost", label: "Lost" },
          { key: "atStake", label: "At stake" },
        ],
      }),
      {
        key: "ledger",
        label: "Ledger",
        items: [
          { type: "checkbox", id: "format.style.showAtStake", label: "Show money still at stake", defaultValue: true },
          { type: "checkbox", id: "format.style.showStrip", label: "Show the split strip", defaultValue: true },
        ],
      },
    ),
  formatShape: paperFormat((s: AgShapeBuilder) =>
    s.object({
      showAtStake: s.boolean({ description: "Show the money still at stake. Default true." }).optional(),
      showStrip: s.boolean({ description: "Show the strip splitting the total by outcome. Default true." }).optional(),
    }) as never,
  ),
  comp: Ledger,
  defaultSize: { width: 380, height: 420 },
  minSize: { width: 240, height: 240 },
  ai: {
    label: "Kept / refunded / lost ledger",
    description:
      "Exhibit's money ledger, drawn as a ledger slip: money kept by fighting (won), refunded by accepting, lost, a subtotal of what PayPal decided, money still at stake and the total, with a strip splitting the total.",
    usage: "Use to compare what fighting kept with what refunds gave back, or for the money picture of the desk. It totals whatever the page's filters leave.",
    configuration: "Map kept to cases.kept, refunded to cases.refunded, lost to cases.lostAmount and atStake to cases.atStake, each with aggregation sum.",
  },
};

const strikes: AgWidgetDefinition<"exhibit-checker-strikes", CheckerStrikesWidget> = {
  id: "exhibit-checker-strikes",
  label: "Checker strikes",
  icon: icon('<path d="M5 3v18M7.5 3v18"/><path d="M10 7h9M10 11h9M10 15h9"/><path d="M9 11.5h11" stroke-width="2"/>'),
  dataMapping: {
    verdict: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, required: true, aiDescription: "The checker's verdict, Kept or Struck (sentences.kept)." },
    reason: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, aiDescription: "Why the checker struck the sentence (sentences.why)." },
    count: {
      type: "field",
      supportedRoles: ["numeric"],
      requires: { per: "dataMapping.verdict", cardinality: "one" },
      required: true,
      aiDescription: "How many sentences (sentences.n with aggregation sum).",
    },
  },
  form: (params: AgWidgetFormParams<CheckerStrikesWidget>) =>
    withSection(
      params.createDefaults({
        dataMappingItems: [
          { key: "verdict", label: "Verdict" },
          { key: "reason", label: "Reason" },
          { key: "count", label: "Sentences" },
        ],
      }),
      {
        key: "pleading",
        label: "Pleading paper",
        items: [
          { type: "checkbox", id: "format.style.showKept", label: "Show kept sentences", defaultValue: true },
          { type: "textfield", id: "format.style.struckWord", label: "Verdict for a struck sentence", defaultValue: "Struck" },
        ],
      },
    ),
  formatShape: paperFormat((s: AgShapeBuilder) =>
    s.object({
      showKept: s.boolean({ description: "Also list the kept sentences. Default true." }).optional(),
      struckWord: s.string({ description: "The verdict value that means struck. Default Struck." }).optional(),
    }) as never,
  ),
  comp: CheckerStrikes,
  defaultSize: { width: 560, height: 420 },
  minSize: { width: 280, height: 200 },
  ai: {
    label: "Checker strikes",
    description:
      "Exhibit's checker on pleading paper: numbered lines down a double red margin, one line per verdict and reason, with struck sentences crossed out in red. Exhibit's checker strikes any brief sentence that doesn't cite a PayPal record.",
    usage: "Use for where or why the checker strikes sentences, or how much of each brief stood up.",
    configuration: "Map verdict to sentences.kept, reason to sentences.why, and count to sentences.n with aggregation sum.",
  },
};

const stamps: AgWidgetDefinition<"exhibit-stamps", StampCountsWidget> = {
  id: "exhibit-stamps",
  label: "Exhibit stamps",
  icon: icon('<rect x="3" y="7" width="18" height="10" rx="2"/><rect x="5" y="9" width="14" height="6" rx="1" stroke-width="1"/>'),
  dataMapping: {
    category: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, required: true, aiDescription: "What each stamp says, e.g. cases.outcome or cases.stage." },
    value: { type: "field", supportedRoles: ["numeric"], requires: { per: "dataMapping.category", cardinality: "one" }, required: true, aiDescription: "The count on each stamp (cases.n with aggregation sum)." },
  },
  form: (params: AgWidgetFormParams<StampCountsWidget>) =>
    withSection(
      params.createDefaults({
        dataMappingItems: [
          { key: "category", label: "Stamp" },
          { key: "value", label: "Count" },
        ],
      }),
      {
        key: "stamp",
        label: "Stamp",
        items: [
          { type: "textfield", id: "format.style.unit", label: "Word under the count", defaultValue: "cases" },
          { type: "checkbox", id: "format.style.tilt", label: "Tilt as if pressed by hand", defaultValue: true },
        ],
      },
    ),
  formatShape: paperFormat((s: AgShapeBuilder) =>
    s.object({
      unit: s.string({ description: "Word under each count, e.g. cases. Default cases." }).optional(),
      tilt: s.boolean({ description: "Tilt the stamps. Default true." }).optional(),
    }) as never,
  ),
  comp: StampCounts,
  defaultSize: { width: 420, height: 300 },
  minSize: { width: 200, height: 140 },
  ai: {
    label: "Exhibit stamps",
    description:
      "Counts as rubber stamps on the page: WON in green, LOST and YOUR MOVE in red, FILED in blue, REFUNDED in black, each with its count. Clicking a stamp cross-filters to it.",
    usage: "Use for counts of cases by outcome or by where they stand. Best with up to six values.",
    configuration: "Map category to cases.outcome or cases.stage, and value to cases.n with aggregation sum.",
  },
};

const CUSTOM = [ladder, ledger, strikes, stamps];

/** Studio's widget config: Exhibit's four widgets first in the menu, and the grid widget drawing case ids as Bates numbers. */
export const exhibitWidgets = (defaults: AgWidgetsConfig<AgDefaultRegistry>): AgWidgetsConfig<ExhibitRegistry> =>
  createWidgets<ExhibitRegistry>({
    additionalTypes: CUSTOM as never,
    overrides: [{ id: "grid", options: { createCellRenderer: exhibitCellRenderer } }] as never,
    menu: [{ label: "Exhibit", widgetIds: CUSTOM.map((w) => w.id) }, ...(defaults.menu as never[])],
  });
