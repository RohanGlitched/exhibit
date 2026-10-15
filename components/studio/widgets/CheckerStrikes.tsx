"use client";

import type { AgWidgetDataFormat, AgWidgetParams } from "ag-studio";
import type { ReactNode } from "react";
import { num, plural, selectedValues, text, useWidgetRows, type Refs } from "./shared";
import styles from "./widgets.module.css";

// Pleading paper is numbered to the foot of the page, written on or not.
const MIN_LINES = 12;

export interface StrikesStyle {
  /** Show the kept sentences as well as the struck ones. */
  showKept?: boolean;
  /** Word the checker's verdict uses for a struck sentence. */
  struckWord?: string;
}

export interface CheckerStrikesWidget {
  type: "exhibit-checker-strikes";
  dataMapping: { verdict: Refs; reason?: Refs; count: Refs };
  format?: AgWidgetDataFormat<StrikesStyle>;
}

/**
 * What Exhibit's checker did to the briefs, set on pleading paper: numbered lines down a double red margin,
 * one line per verdict and reason. Struck lines carry a red strike-through, the way a clerk crosses out a
 * line that can't stand; kept lines say how many sentences stood on a record. Clicking a line
 * cross-filters the page to the sentences behind it.
 */
export default function CheckerStrikes(params: AgWidgetParams<CheckerStrikesWidget>) {
  const { dataMapping, format, widgetApi } = params;
  const verdictField = dataMapping.verdict?.[0];
  const reasonField = dataMapping.reason?.[0];
  const countField = dataMapping.count?.[0];
  const showKept = format?.style?.showKept ?? true;
  const struckWord = (format?.style?.struckWord ?? "Struck").toLowerCase();

  const data = useWidgetRows(params as AgWidgetParams, () => ({ fields: [verdictField, reasonField, countField], ready: !!verdictField && !!countField }));
  if (!data || !verdictField || !countField) return null;

  const lines = data.rows.map((r) => {
    const verdict = text(r[verdictField.key]);
    return {
      verdict,
      struck: verdict.toLowerCase().startsWith(struckWord),
      reason: reasonField ? text(r[reasonField.key]) : "",
      count: num(r[countField.key]),
    };
  });
  const total = lines.reduce((s, l) => s + l.count, 0);
  const struck = lines.filter((l) => l.struck).sort((a, b) => b.count - a.count);
  const kept = lines.filter((l) => !l.struck).sort((a, b) => b.count - a.count);
  const struckTotal = struck.reduce((s, l) => s + l.count, 0);
  const keptTotal = total - struckTotal;
  const pickedReasons = selectedValues(params as AgWidgetParams, reasonField ?? verdictField);
  const filterField = reasonField ?? verdictField;

  const body: { key: string; node: ReactNode; struck?: boolean; value?: string }[] = [
    {
      key: "head",
      node: (
        <>
          Of {plural(total, "sentence")} Exhibit wrote, the checker kept <b>{keptTotal}</b> and struck <b data-tone="due">{struckTotal}</b>.
        </>
      ),
    },
    { key: "gap", node: "" },
  ];
  if (struck.length === 0) {
    body.push({ key: "none", node: <em>No sentence struck. Every line of every brief cites a PayPal record.</em> });
  }
  for (const l of struck) {
    const reason = l.reason && !l.reason.toLowerCase().startsWith(struckWord) ? l.reason : "no record behind it";
    body.push({
      key: `s-${l.reason}-${l.verdict}`,
      struck: true,
      value: reasonField ? l.reason : l.verdict,
      node: (
        <>
          <s className={styles.strike}>{plural(l.count, "sentence")} without a record</s> <span className={styles.clerk}>{reason}</span>
        </>
      ),
    });
  }
  if (showKept) {
    for (const l of kept) {
      body.push({ key: `k-${l.reason}-${l.verdict}`, value: reasonField ? l.reason : l.verdict, node: `${plural(l.count, "sentence")} kept, each citing the record that proves it` });
    }
  }

  return (
    <div className={`${styles.paper} ${styles.pleading}`}>
      <ol className={styles.pleadLines}>
        {body.map((b) => {
          const on = b.value != null && pickedReasons.has(b.value);
          const content = b.value != null ? (
            <button
              type="button"
              className={styles.pleadButton}
              aria-pressed={on}
              data-dim={pickedReasons.size > 0 && !on}
              onClick={() => widgetApi.toggleCrossFilter({ type: "value", field: filterField, value: b.value, group: 0 })}
            >
              <span>{b.node}</span>
            </button>
          ) : (
            <span>{b.node}</span>
          );
          return (
            <li key={b.key} data-struck={b.struck}>
              {content}
            </li>
          );
        })}
        {Array.from({ length: Math.max(0, MIN_LINES - body.length) }, (_, i) => (
          <li key={`blank-${i}`} aria-hidden="true" />
        ))}
      </ol>
    </div>
  );
}
