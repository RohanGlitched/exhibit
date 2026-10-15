"use client";

import type { AgWidgetDataFormat, AgWidgetParams } from "ag-studio";
import { useId } from "react";
import { num, selectedValues, text, useWidgetRows, type Refs } from "./shared";
import styles from "./widgets.module.css";

export interface StampsStyle {
  /** Word under the count on each stamp, e.g. "cases". */
  unit?: string;
  /** Tilt the stamps as if pressed by hand. */
  tilt?: boolean;
}

export interface StampCountsWidget {
  type: "exhibit-stamps";
  dataMapping: { category: Refs; value: Refs };
  format?: AgWidgetDataFormat<StampsStyle>;
}

// The ink each word is stamped in: green only for a win, red for a loss or a clock running out, blue for
// what is with PayPal, and plain ink for the rest.
const TONE: Record<string, string> = {
  won: "won",
  lost: "due",
  "your move": "due",
  refunded: "ink",
  refund: "ink",
  filed: "respondent",
  pending: "respondent",
  "paypal reviewing": "respondent",
  fight: "respondent",
};

const ORDER = ["won", "filed", "your move", "paypal reviewing", "pending", "refunded", "lost"];

/**
 * Counts as rubber stamps on the page, the way a clerk marks a file: WON in green, LOST and YOUR MOVE in red,
 * FILED in blue, REFUNDED in black, each with its count. The ink is roughened by an SVG filter so it reads
 * as a stamp rather than a badge. Clicking a stamp cross-filters the page to it.
 */
export default function StampCounts(params: AgWidgetParams<StampCountsWidget>) {
  const { dataMapping, format, widgetApi } = params;
  const categoryField = dataMapping.category?.[0];
  const valueField = dataMapping.value?.[0];
  const unit = format?.style?.unit ?? "cases";
  const tilt = format?.style?.tilt ?? true;
  const filterId = `ink-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  const data = useWidgetRows(params as AgWidgetParams, () => ({ fields: [categoryField, valueField], ready: !!categoryField && !!valueField }));
  if (!data || !categoryField || !valueField) return null;

  const picked = selectedValues(params as AgWidgetParams, categoryField);
  const stamps = data.rows
    .map((r) => ({ word: text(r[categoryField.key]) || "Other", value: num(r[valueField.key]) }))
    .filter((s) => s.value > 0)
    .sort((a, b) => {
      const ia = ORDER.indexOf(a.word.toLowerCase());
      const ib = ORDER.indexOf(b.word.toLowerCase());
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || b.value - a.value;
    });

  return (
    <div className={`${styles.paper} ${styles.stamps}`}>
      <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}>
        <defs>
          <filter id={filterId} x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise" />
            <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.5 1.3" result="mask" />
            <feComposite in="SourceGraphic" in2="mask" operator="in" result="inked" />
            <feTurbulence type="turbulence" baseFrequency="0.035" numOctaves="2" seed="3" result="warp" />
            <feDisplacementMap in="inked" in2="warp" scale="2.2" />
          </filter>
        </defs>
      </svg>
      {stamps.map((s, i) => {
        const word = s.word.toUpperCase();
        const on = picked.has(s.word);
        const size = word.length > 9 ? 32 : word.length > 6 ? 38 : 46;
        // Long words are squeezed to fit the frame, as a stamp maker would cut them.
        const fit = word.length > 11 ? { textLength: 250, lengthAdjust: "spacingAndGlyphs" as const } : {};
        const count = widgetApi.formatFieldValue(valueField, s.value);
        const u = s.value === 1 && unit.endsWith("s") ? unit.slice(0, -1) : unit;
        return (
          <button
            key={s.word}
            type="button"
            className={styles.stamp}
            data-tone={TONE[s.word.toLowerCase()] ?? "ink"}
            aria-pressed={on}
            data-dim={picked.size > 0 && !on}
            style={{ transform: tilt ? `rotate(${[-7, 4, -3, 6, -5, 3][i % 6]}deg)` : undefined }}
            onClick={() => widgetApi.toggleCrossFilter({ type: "value", field: categoryField, value: s.word, group: 0 })}
            aria-label={`${s.word}: ${count} ${u}`}
          >
            <svg viewBox="0 0 300 130" aria-hidden="true">
              <g filter={`url(#${filterId})`} fill="none" stroke="currentColor">
                <rect x="6" y="6" width="288" height="118" rx="10" strokeWidth="5" />
                <rect x="16" y="16" width="268" height="98" rx="6" strokeWidth="2.6" />
                <text x="150" y="70" textAnchor="middle" fill="currentColor" stroke="none" fontSize={size} fontWeight="800" letterSpacing={fit.textLength ? 1 : 5} fontFamily="var(--font-sans), sans-serif" {...fit}>
                  {word}
                </text>
                <text x="150" y="102" textAnchor="middle" fill="currentColor" stroke="none" fontSize="23" fontWeight="800" letterSpacing="2" fontFamily="var(--font-sans), sans-serif">
                  {`${count} ${u}`.toUpperCase()}
                </text>
              </g>
            </svg>
          </button>
        );
      })}
    </div>
  );
}
