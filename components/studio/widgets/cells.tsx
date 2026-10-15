"use client";

import type { AgWidgetField } from "ag-studio";
import type { CustomCellRendererProps } from "ag-grid-react";
import type { ComponentType } from "react";
import styles from "./widgets.module.css";

/** Case ids print as Bates numbers, in stamp red. */
function Bates({ value }: CustomCellRendererProps) {
  return value == null ? null : <span className={styles.bates}>{String(value)}</span>;
}

/** Where a case stands, as the same quiet chip the desk uses. */
function Stage({ value }: CustomCellRendererProps) {
  if (value == null) return null;
  const v = String(value);
  return (
    <span className={styles.chip} data-tone={v === "Won" ? "won" : v === "Lost" || v === "Your move" ? "due" : v === "Refunded" ? "ink" : "respondent"}>
      {v}
    </span>
  );
}

/** Days left on PayPal's clock: red at two or fewer, blank when it isn't the seller's move. */
function Days({ value }: CustomCellRendererProps) {
  if (value == null || value === "") return <span className={styles.faint}>Not on the clock</span>;
  const d = Number(value);
  return (
    <span className={styles.daysCell} data-soon={d <= 2}>
      <span className={styles.dueBar}>
        <i style={{ width: `${Math.max(0, Math.min(100, d * 10))}%` }} />
      </span>
      {d <= 0 ? "Today" : `${d} d`}
    </span>
  );
}

const BY_FIELD: Record<string, ComponentType<CustomCellRendererProps>> = {
  "cases.caseId": Bates,
  "sentences.caseId": Bates,
  "cases.stage": Stage,
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
