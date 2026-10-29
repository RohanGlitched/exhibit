"use client";

import type { AgWidgetDataFormat, AgWidgetParams } from "ag-studio";
import { daysWords, openCase } from "./cells";
import { MISSED_SHOWN, splitLadder } from "./ladder";
import { num, plural, selectedValues, text, usd, useWidgetRows, type Refs } from "./shared";
import Busy from "./Busy";
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
 * in due red. Deadlines that already passed with no answer are not rungs: they sit under the ladder in grey,
 * as missed. Clicking a case cross-filters the page to it; double-clicking opens the case.
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

  // The ladder draws its own line when it has no rows, rather than Studio's generic no-data overlay.
  const data = useWidgetRows(
    params as AgWidgetParams,
    () => ({ fields: [caseField, daysField, amountField, labelField], ready: !!caseField && !!daysField }),
    undefined,
    true,
  );
  const picked = selectedValues(params as AgWidgetParams, caseField);

  // Always an element, never null: Studio attaches a React widget only once it has drawn something.
  if (!data || !caseField || !daysField) return <Busy lines={7} />;

  // Only cases on PayPal's clock have a day count; the rest are filed, decided or with PayPal.
  const { live, missed, urgent: soon } = splitLadder(
    data.rows
      .filter((r) => r[daysField.key] != null)
      .map((r) => ({
        id: text(r[caseField.key]),
        days: num(r[daysField.key]),
        amount: amountField ? num(r[amountField.key]) : null,
        label: labelField ? text(r[labelField.key]) : "",
      })),
    urgent,
  );

  const toggle = (id: string) => widgetApi.toggleCrossFilter({ type: "value", field: caseField, value: id, group: 0 });
  const money = (rows: { amount: number | null }[]) => (amountField ? `, ${usd(rows.reduce((s, r) => s + (r.amount ?? 0), 0))}` : "");

  if (data.rows.length === 0) {
    return (
      <div className={styles.paper}>
        <p className={styles.empty}>No cases to put on the ladder: nothing on the desk matches what this page is showing.</p>
      </div>
    );
  }

  if (live.length === 0 && missed.length === 0) {
    return (
      <div className={styles.paper}>
        <p className={styles.empty}>Nothing on your move. Every case has an answer filed or a ruling from PayPal.</p>
      </div>
    );
  }

  const shown = live.slice(0, maxRungs);
  const rest = live.slice(maxRungs);
  const missedShown = missed.slice(0, MISSED_SHOWN);
  const missedRest = missed.slice(MISSED_SHOWN);

  return (
    <div className={styles.paper}>
      <p className={styles.ladderHead}>
        {live.length > 0 ? (
          <span>
            <strong>{plural(live.length, "case")}</strong> on your move
          </span>
        ) : (
          <span>Nothing live on your move</span>
        )}
        <span>
          {missed.length > 0 && <span className={styles.faint}>{missed.length} overdue</span>}
          {missed.length > 0 && soon.count > 0 && " · "}
          {soon.count > 0 && (
            <span className={styles.due}>
              {soon.count} due within {plural(urgent, "day")}
              {amountField ? `, ${usd(soon.amount)}` : ""}
            </span>
          )}
        </span>
      </p>
      {live.length === 0 ? (
        <p className={styles.empty}>No deadline is open inside PayPal&apos;s window: every case has an answer filed, a ruling, or a missed deadline below.</p>
      ) : (
        <ol className={styles.ladder} aria-label="Cases on your move, soonest deadline first">
          {shown.map((r) => {
            const red = r.days <= urgent;
            const on = picked.has(r.id);
            return (
              <li key={r.id}>
                <button
                  type="button"
                  className={styles.rung}
                  data-soon={red}
                  aria-pressed={on}
                  data-dim={picked.size > 0 && !on}
                  onClick={() => toggle(r.id)}
                  onDoubleClick={() => openCase(r.id)}
                  title={`Click to show only ${r.id}; double-click to open it`}
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
                  <span className={styles.rungDays}>{daysWords(r.days)}</span>
                  {r.amount != null && <span className={styles.rungAmount}>{usd(r.amount)}</span>}
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {rest.length > 0 && (
        <p className={styles.more}>
          and {plural(rest.length, "more case")} with {rest[0].days} or more days left{money(rest)}
        </p>
      )}
      {live.length > 0 && (
        <p className={styles.scale} aria-hidden="true">
          Each box is a day of PayPal&apos;s {windowDays}-day window to answer
        </p>
      )}
      {missed.length > 0 && (
        <>
          <p className={styles.missedHead}>
            <strong>Missed</strong>
            <span>
              PayPal&apos;s deadline passed with no answer{money(missed)}
            </span>
          </p>
          <ul className={styles.missedList} aria-label="Deadlines missed with no answer">
            {missedShown.map((r) => {
              const on = picked.has(r.id);
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    className={styles.missedRow}
                    aria-pressed={on}
                    data-dim={picked.size > 0 && !on}
                    onClick={() => toggle(r.id)}
                    onDoubleClick={() => openCase(r.id)}
                    title={`Click to show only ${r.id}; double-click to open it`}
                  >
                    <span className={styles.bates}>{r.id}</span>
                    <span className={styles.rungLabel}>{r.label}</span>
                    <span className={styles.missedWhen}>{daysWords(r.days)}</span>
                    {r.amount != null && <span className={styles.missedAmount}>{usd(r.amount)}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {missedRest.length > 0 && (
            <p className={styles.more}>
              and {plural(missedRest.length, "more missed case")}
              {money(missedRest)}
            </p>
          )}
        </>
      )}
    </div>
  );
}
