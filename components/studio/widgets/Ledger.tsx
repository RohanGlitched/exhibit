"use client";

import type { AgWidgetDataFormat, AgWidgetParams } from "ag-studio";
import { num, usd, useWidgetRows, type Refs } from "./shared";
import Busy from "./Busy";
import styles from "./widgets.module.css";

export interface LedgerStyle {
  /** Show the money still undecided below the decided lines. */
  showAtStake?: boolean;
  /** Show the strip that splits the total by where the money went. */
  showStrip?: boolean;
}

export interface LedgerWidget {
  type: "exhibit-ledger";
  dataMapping: { kept: Refs; refunded: Refs; lost?: Refs; atStake?: Refs };
  format?: AgWidgetDataFormat<LedgerStyle>;
}

const LINES = [
  { key: "kept", label: "Kept by fighting", tone: "won" },
  { key: "refunded", label: "Refunded by accepting", tone: "ink" },
  { key: "lost", label: "Lost", tone: "due" },
] as const;

/**
 * The money as a ledger slip: what the seller kept by fighting, refunded by accepting and lost, a rule,
 * what PayPal has decided, then what is still at stake and the total, with a strip splitting the total.
 * The lines follow every filter on the page, so a cross filter on one case or reason re-totals the slip.
 */
export default function Ledger(params: AgWidgetParams<LedgerWidget>) {
  const { dataMapping, format } = params;
  const fields = { kept: dataMapping.kept?.[0], refunded: dataMapping.refunded?.[0], lost: dataMapping.lost?.[0], atStake: dataMapping.atStake?.[0] };
  const showAtStake = format?.style?.showAtStake ?? true;
  const showStrip = format?.style?.showStrip ?? true;

  const data = useWidgetRows(params as AgWidgetParams, () => ({
    fields: [fields.kept, fields.refunded, fields.lost, fields.atStake],
    ready: !!fields.kept && !!fields.refunded,
  }));
  // Always an element, never null: Studio attaches a React widget only once it has drawn something.
  if (!data) return <Busy lines={5} />;

  const row = data.rows[0] ?? {};
  const v = (k: keyof typeof fields) => (fields[k] ? num(row[fields[k]!.key]) : 0);
  const kept = v("kept");
  const refunded = v("refunded");
  const lost = v("lost");
  const atStake = fields.atStake && showAtStake ? v("atStake") : 0;
  const decided = kept + refunded + lost;
  const total = decided + atStake;
  const parts = [
    { tone: "won", value: kept, label: "kept" },
    { tone: "ink", value: refunded, label: "refunded" },
    { tone: "due", value: lost, label: "lost" },
    { tone: "respondent", value: atStake, label: "at stake" },
  ].filter((p) => p.value > 0);

  return (
    <div className={`${styles.paper} ${styles.ledger}`}>
      <dl className={styles.lines}>
        {LINES.filter((l) => l.key !== "lost" || fields.lost).map((l) => (
          <div key={l.key} className={styles.line} data-tone={v(l.key) > 0 ? l.tone : undefined}>
            <dt>{l.label}</dt>
            <span className={styles.leader} aria-hidden="true" />
            <dd>{usd(v(l.key))}</dd>
          </div>
        ))}
        <div className={`${styles.line} ${styles.subtotal}`}>
          <dt>Decided by PayPal</dt>
          <span className={styles.leader} aria-hidden="true" />
          <dd>{usd(decided)}</dd>
        </div>
        {fields.atStake && showAtStake && (
          <div className={styles.line} data-tone="respondent">
            <dt>Still at stake</dt>
            <span className={styles.leader} aria-hidden="true" />
            <dd>{usd(atStake)}</dd>
          </div>
        )}
        <div className={`${styles.line} ${styles.total}`}>
          <dt>Total disputed</dt>
          <span className={styles.leader} aria-hidden="true" />
          <dd>{usd(total)}</dd>
        </div>
      </dl>
      {showStrip && total > 0 && (
        <div className={styles.strip} role="img" aria-label={parts.map((p) => `${usd(p.value)} ${p.label}`).join(", ")}>
          {parts.map((p) => (
            <i key={p.label} data-tone={p.tone} style={{ flexGrow: p.value }} title={`${usd(p.value)} ${p.label}`} />
          ))}
        </div>
      )}
      {decided > 0 && (
        <p className={styles.ledgerNote}>
          {kept > 0 ? `Fighting kept ${Math.round((kept / decided) * 100)}% of the decided money.` : "Nothing kept by fighting yet."}
          {refunded > 0 ? ` Refunds returned ${usd(refunded)} the seller chose not to fight.` : ""}
        </p>
      )}
    </div>
  );
}
