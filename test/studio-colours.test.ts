import { test } from "node:test";
import assert from "node:assert/strict";
import { MONEY_SERIES, initialReport } from "../components/studio/report.ts";
import { INK, PALETTE } from "../components/studio/palette.ts";
import { SAVED_WIDGET } from "../components/studio/saved.ts";

const ink = (id: string) => PALETTE[MONEY_SERIES.indexOf(id as (typeof MONEY_SERIES)[number])];

test("money series take the inks the page states: lost red, kept green, refunded plain ink, at stake blue", () => {
  assert.equal(ink("cases.lostAmount"), INK.due);
  assert.equal(ink("cases.kept"), INK.won);
  assert.equal(ink("cases.refunded"), INK.ink);
  assert.equal(ink("cases.atStake"), INK.respondent);
});

test("the saved analyst widget is shown in the palette's order, and kept is split by who decided", () => {
  const money = initialReport(false, null).pages!.find((p) => p.id === "money")!;
  const widgets = money.widgets as Record<string, { dataMapping?: { valueKey?: { id: string }[] } } & { format?: { title?: { text?: string } } }>;
  if (SAVED_WIDGET) {
    const saved = widgets[SAVED_WIDGET.id];
    assert.deepEqual(
      saved.dataMapping!.valueKey!.map((v) => v.id),
      [...MONEY_SERIES],
    );
  }
  assert.equal(widgets["kpi-kept"], undefined);
  assert.equal(widgets["kpi-kept-asked"].format?.title?.text, "Kept, ruled on request");
  assert.equal(widgets["kpi-kept-sandbox"].format?.title?.text, "Kept, sandbox closed it");
  // No widget on the page is wider than the canvas.
  for (const l of Object.values(money.widgetLayout ?? {})) if (l) assert.ok(l.xTrack + l.xSpan <= 24);
});
