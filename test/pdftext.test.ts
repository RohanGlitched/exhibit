import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { filedRecord, pdfLines } from "../lib/cases/pdftext.ts";

/** A PDF laid out the way lib/cases/pdf.ts lays out a filing: response page, then one page per exhibit, Bates-stamped. */
async function filing(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  let bates = 0;
  const page = (lines: string[]) => {
    const p = doc.addPage([612, 792]);
    let y = 740;
    for (const l of lines) {
      p.drawText(l, { x: 64, y, size: 11, font: l.startsWith("We") || l.startsWith("tracking") ? serif : sans });
      y -= 16;
    }
    p.drawText(`HC-${String(++bates).padStart(6, "0")}`, { x: 500, y: 36, size: 9, font: sans });
    p.drawText("Halden Ceramics · PP-R-OCC-10190303", { x: 64, y: 36, size: 8, font: sans });
  };
  page([
    "Halden Ceramics",
    "12 Alder Street, Portland, OR",
    "Response to PayPal case PP-R-OCC-10190303",
    "Item not received · $104.00 disputed · store order HC-104233 · 15 Oct 2026",
    "We shipped it with USPS Ground Advantage,",
    "tracking 9405511206213859470035. [B]",
    "We’re sure the buyer got it: USPS shows “Delivered, signed”. [C, D]",
    "Exhibits",
    "A  The buyer's claim",
    "Mira Okafor, Halden Ceramics · studio@halden.example",
  ]);
  page(["Exhibit A", "The buyer's claim: not received", "PayPal · GET /v1/customer/disputes", "Amount disputed", "$104.00"]);
  page(["Exhibit B", "Tracking on file with PayPal", "Tracking number", "9405511206213859470035"]);
  page(["27 Sep 2026, 13:00  Delivered, signed"]); // B runs on to a second page
  return doc.save();
}

test("reads every page's text back in drawing order, WinAnsi characters included", async () => {
  const pages = await pdfLines(await filing());
  assert.equal(pages.length, 4);
  assert.equal(pages[0][0], "Halden Ceramics");
  assert.ok(pages[0].includes("We’re sure the buyer got it: USPS shows “Delivered, signed”. [C, D]"));
  assert.ok(pages[1].includes("HC-000002"));
});

test("splits the filing into the response sentences and Bates-labelled exhibit pages", async () => {
  const r = filedRecord(await pdfLines(await filing()));
  assert.deepEqual(r.response, [
    { text: "We shipped it with USPS Ground Advantage, tracking 9405511206213859470035.", cites: ["B"] },
    { text: "We’re sure the buyer got it: USPS shows “Delivered, signed”.", cites: ["C", "D"] },
  ]);
  assert.deepEqual(r.pages.map((p) => p.bates), ["HC-000001", "HC-000002", "HC-000003", "HC-000004"]);
  assert.deepEqual(r.exhibitPages.map((p) => [p.bates, p.exhibit]), [["HC-000002", "A"], ["HC-000003", "B"]]);
  assert.match(r.exhibitPages[1].text, /continued on HC-000004\)\n27 Sep 2026, 13:00/);
  // The footer and the stamp are not part of what a reviewer reads.
  assert.ok(!r.pages[0].text.includes("HC-000001"));
  assert.ok(r.pages.every((p) => !p.text.includes("Halden Ceramics · PP-R-OCC-10190303")));
});
