"use client";

import type { AgWidgetField } from "ag-studio";
import type { CustomCellRendererProps } from "ag-grid-react";
import type { ComponentType } from "react";
import styles from "./widgets.module.css";

/** Opens a case page from inside a widget. Studio renders widgets in its own tree, so this is a plain navigation. */
export const openCase = (id: string) => window.location.assign(`/case/${encodeURIComponent(id)}`);

/** Case ids print as Bates numbers, in stamp red. A click still cross-filters; a double-click opens the case. */
function Bates({ value }: CustomCellRendererProps) {
  if (value == null) return null;
  const id = String(value);
  return (
    <span className={styles.bates} data-opens="true" title={`Double-click to open ${id}`} onDoubleClick={() => openCase(id)}>
      {id}
    </span>
  );
}

/** Where a case stands, as the same quiet chip the desk uses (the queue field's order number is not printed). */
function Stage({ value }: CustomCellRendererProps) {
  if (value == null) return null;
  const v = String(value).replace(/^\d+ /, "");
  const tone = v === "Won" ? "won" : v === "Lost" || v === "Your move" ? "due" : v === "Refunded" ? "ink" : /^miss/i.test(v) ? "missed" : "respondent";
  return (
    <span className={styles.chip} data-tone={tone}>
      {v}
    </span>
  );
}

/** Words for days left on PayPal's clock; below zero the deadline passed with no answer. Shared with the ladder. */
export function daysWords(d: number): string {
  if (d < 0) return `Missed ${-d} day${d === -1 ? "" : "s"} ago`;
  if (d === 0) return "Due today";
  return d === 1 ? "1 day" : `${d} days`;
}

/**
 * Days left on PayPal's clock: red at two or fewer, blank when it isn't the seller's move. Below zero the
 * deadline has passed with no answer, so the cell says how long ago it was missed rather than "today".
 */
function Days({ value }: CustomCellRendererProps) {
  if (value == null || value === "") return <span className={styles.faint}>Not on the clock</span>;
  const d = Number(value);
  if (d < 0)
    return (
      <span className={styles.missedCell} title={`PayPal's deadline passed ${-d} day${d === -1 ? "" : "s"} ago with no answer`}>
        {-d} d ago
      </span>
    );
  return (
    <span className={styles.daysCell} data-soon={d <= 2}>
      <span className={styles.dueBar}>
        <i style={{ width: `${Math.max(0, Math.min(100, d * 10))}%` }} />
      </span>
      {d === 0 ? "Today" : `${d} d`}
    </span>
  );
}

const BY_FIELD: Record<string, ComponentType<CustomCellRendererProps>> = {
  "cases.caseId": Bates,
  "sentences.caseId": Bates,
  "cases.stage": Stage,
  "cases.queue": Stage,
  "cases.daysLeft": Days,
};

/**
 * Cell renderers for Studio's built-in grid widget, so the grids read like the rest of Exhibit. Unaggregated
 * columns only: an aggregated column (a sum of days, say) keeps Studio's own rendering.
 */
export function exhibitCellRenderer(field: AgWidgetField): ComponentType<CustomCellRendererProps> | undefined {
  if (field.type === "implicitMeasure") return undefined;
  return BY_FIELD[String(field.fieldId)];
}
