import { useEffect, useRef, useState } from "react";
import type {
  AgExternalShape,
  AgFormatShapeParams,
  AgShape,
  AgShapeBuilder,
  AgWidgetDataRequestOptions,
  AgWidgetField,
  AgWidgetFieldReference,
  AgWidgetParams,
} from "ag-studio";

/** Field references as they sit in a widget's saved state. */
export type Refs = AgWidgetFieldReference[];

export type Row = Record<string, unknown>;

/**
 * Fetches a custom widget's rows through Studio, so page filters, filter widgets and cross filters from
 * other widgets all apply, and sets the widget's display state as it goes. Studio hands a React widget new
 * props on every refresh (a filter, a new mapping, new data), so the query reruns whenever the props change.
 *
 * Until the rows arrive the hook returns null, and the widget must still render an element then (a blank
 * sheet of paper), never null: AG Studio's React wrapper attaches a function component to the page only once
 * its portal holds a DOM node, polls for that for one second, and then gives up without ever attaching it or
 * passing it another refresh. A widget that returned null while a slow first query ran stayed blank for good.
 *
 * `ownEmptyState` is for a widget that draws its own line when there are no rows: Studio is told the widget
 * is displayed, so its generic no-data overlay doesn't cover that line. A failed query gives no rows.
 */
export function useWidgetRows(
  params: AgWidgetParams,
  pick: () => { fields: (AgWidgetField | undefined)[]; ready: boolean },
  options?: AgWidgetDataRequestOptions,
  ownEmptyState = false,
): { rows: Row[]; cross?: Row[] } | null {
  const [result, setResult] = useState<{ rows: Row[]; cross?: Row[] } | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    const { widgetApi } = params;
    const { fields, ready } = pick();
    if (!ready) {
      widgetApi.setDisplayState("incompleteDataMapping");
      setResult(null);
      return;
    }
    let live = true;
    widgetApi.setDisplayState("loading", { prominent: !loaded.current });
    widgetApi
      .getData({ fields: fields.filter((f): f is AgWidgetField => f != null) }, options)
      .then((res) => {
        if (!live) return;
        loaded.current = true;
        const rows = res.results.rows;
        setResult({ rows, cross: res.crossFilter?.rows });
        widgetApi.setDisplayState(rows.length > 0 || ownEmptyState ? "displayed" : "noData");
      })
      .catch((err: unknown) => {
        // A newer refresh cancels the request in flight; that one is not an error.
        if (!live || (err instanceof Error && err.name === "AbortError")) return;
        loaded.current = true;
        setResult({ rows: [] });
        widgetApi.setDisplayState(ownEmptyState ? "displayed" : "noData");
      });
    return () => {
      live = false;
    };
    // The props object is new on each refresh from Studio and stable across this widget's own renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  return result;
}

/** The values this widget has selected as a cross filter on `field`, if any. */
export function selectedValues(params: AgWidgetParams, field: AgWidgetField | undefined): Set<unknown> {
  if (!field) return new Set();
  const found = params.widgetApi.getCrossFilterSelections()?.find((s) => s.type === "value" && s.field.fieldId === field.fieldId);
  return new Set(found && found.type === "value" ? found.values : []);
}

export const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
export const text = (v: unknown) => (v == null ? "" : String(v));

const titleShape = (s: AgShapeBuilder) =>
  s
    .object({
      enabled: s.boolean().optional(),
      text: s.string().optional(),
      textAlign: s.enum(["left", "center", "right"]).optional(),
      color: s.string().optional(),
      wrapping: s.boolean().optional(),
      typography: s
        .object({
          fontFamily: s.string().optional(),
          fontSize: s.number().optional(),
          fontWeight: s.enum(["normal", "bold"]).optional(),
          fontStyle: s.enum(["normal", "italic"]).optional(),
        })
        .optional(),
    })
    .optional();

/**
 * The format shape for one of Exhibit's widgets: Studio's titles and cross-filter setting, plus the widget's
 * own style options. Studio's agents read it as the schema for configure_widget, and Studio parses saved
 * format through it. Studio has no public shape builder for formats, so the builder comes from
 * `api.defineAiCommand`, which hands its factory one synchronously.
 */
export function paperFormat(style: (s: AgShapeBuilder) => AgShape<never>) {
  return ({ api }: AgFormatShapeParams): AgExternalShape<never> => {
    let shape: AgShape<never> | undefined;
    api.defineAiCommand((s: AgShapeBuilder) => {
      shape = s.object({
        title: titleShape(s),
        subtitle: titleShape(s),
        caption: titleShape(s),
        crossFilter: s.enum(["filter", "highlight", "none"]).optional(),
        style: style(s).optional(),
      }) as unknown as AgShape<never>;
      return { input: s.object({}), execute: () => ({ success: true as const, value: null }) };
    });
    return shape as unknown as AgExternalShape<never>;
  };
}

/** Days, money and counts the way the rest of Exhibit writes them. */
export const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
