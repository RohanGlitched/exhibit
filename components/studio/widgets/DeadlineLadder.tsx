"use client";

import type { AgWidgetDataFormat, AgWidgetParams } from "ag-studio";
import { num, plural, selectedValues, text, usd, useWidgetRows, type Refs } from "./shared";
import styles from "./widgets.module.css";

export interface LadderStyle {
  /** Rungs with this many days left or fewer are inked red. */
  urgentDays?: number;
  /** Length of PayPal's response window, in days. */
  windowDays?: number;
  /** Most rungs to draw before the rest are summed up underneath. */
  maxRungs?: number;
}

export interface DeadlineLadderWidget {
  type: "exhibit-deadline-ladder";
  dataMapping: { case: Refs; daysLeft: Refs; amount?: Refs; label?: Refs };
  format?: AgWidgetDataFormat<LadderStyle>;
}

/**
 * Cases on the seller's move as the rungs of a ladder, soonest PayPal deadline at the top. Each rung is
 * the ten-day window as ten boxes, the days still left filled in; two days or fewer and the rung is inked
 * in due red. Clicking a rung cross-filters the page to that case.
 */
export default function DeadlineLadder(params: AgWidgetParams<DeadlineLadderWidget>) {
  const { dataMapping, format, widgetApi } = params;
  const caseField = dataMapping.case?.[0];
  const daysField = dataMapping.daysLeft?.[0];
  const amountField = dataMapping.amount?.[0];
  const labelField = dataMapping.label?.[0];
  const urgent = format?.style?.urgentDays ?? 2;
  const windowDays = Math.max(1, Math.min(30, format?.style?.windowDays ?? 10));
  const maxRungs = format?.style?.maxRungs ?? 12;

  const data = useWidgetRows(params as AgWidgetParams, () => ({ fields: [caseField, daysField, amountField, labelField], ready: !!caseField && !!daysField }));
  const picked = selectedValues(params as AgWidgetParams, caseField);

  if (!data || !caseField || !daysField) return null;

  // Only cases still on the clock have days left; the rest are filed, decided or with PayPal.
  const rungs = data.rows
    .filter((r) => r[daysField.key] != null)
    .map((r) => ({
      id: text(r[caseField.key]),
      days: num(r[daysField.key]),
      amount: amountField ? num(r[amountField.key]) : null,
      label: labelField ? text(r[labelField.key]) : "",
    }))
    .sort((a, b) => a.days - b.days || (b.amount ?? 0) - (a.amount ?? 0));

  if (rungs.length === 0) {
    return (
      <div className={styles.paper}>
        <p className={styles.empty}>Nothing on your move. Every case has an answer filed or a ruling from PayPal.</p>
      </div>
    );
  }

  const shown = rungs.slice(0, maxRungs);
  const rest = rungs.slice(maxRungs);
  const urgentCount = rungs.filter((r) => r.days <= urgent).length;
  const urgentMoney = rungs.filter((r) => r.days <= urgent).reduce((s, r) => s + (r.amount ?? 0), 0);

  return (
    <div className={styles.paper}>
      <p className={styles.ladderHead}>
        <span>
          <strong>{plural(rungs.length, "case")}</strong> on your move
        </span>
        {urgentCount > 0 && (
          <span className={styles.due}>
            {urgentCount} due within {plural(urgent, "day")}
            {amountField ? `, ${usd(urgentMoney)}` : ""}
          </span>
        )}
      </p>
      <ol className={styles.ladder} aria-label="Cases on your move, soonest deadline first">
        {shown.map((r) => {
          const soon = r.days <= urgent;
          const on = picked.has(r.id);
          return (
            <li key={r.id}>
              <button
                type="button"
                className={styles.rung}
                data-soon={soon}
                aria-pressed={on}
                data-dim={picked.size > 0 && !on}
                onClick={() => widgetApi.toggleCrossFilter({ type: "value", field: caseField, value: r.id, group: 0 })}
                title={`Show only ${r.id}`}
              >
                <span className={styles.rungId}>
                  <span className={styles.bates}>{r.id}</span>
                  {r.label && <span className={styles.rungLabel}>{r.label}</span>}
                </span>
                <span className={styles.window} aria-hidden="true">
                  {Array.from({ length: windowDays }, (_, i) => (
                    <i key={i} data-left={i < r.days} />
                  ))}
                </span>
                <span className={styles.rungDays}>{r.days <= 0 ? "Due today" : r.days === 1 ? "1 day" : `${r.days} days`}</span>
                {r.amount != null && <span className={styles.rungAmount}>{usd(r.amount)}</span>}
              </button>
            </li>
          );
        })}
      </ol>
      {rest.length > 0 && (
        <p className={styles.more}>
          and {plural(rest.length, "more case")} with {rest[0].days} or more days left
          {amountField ? `, ${usd(rest.reduce((s, r) => s + (r.amount ?? 0), 0))}` : ""}
        </p>
      )}
      <p className={styles.scale} aria-hidden="true">
        Each box is a day of PayPal&apos;s {windowDays}-day window to answer
      </p>
    </div>
  );
}
