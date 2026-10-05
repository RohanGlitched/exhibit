import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { SHOP } from "../shop/catalog";
import { day, reasonLabel, usd } from "../format";
import type { Dispute } from "../paypal/disputes";
import type { Brief, Exhibit } from "./types";

/**
 * The filed response as a PDF: page one is the seller's response with exhibit marks, then one page per exhibit,
 * each Bates-stamped (HC-000001…) the way litigation exhibits are. Uploaded to PayPal with the evidence.
 */

const INK = rgb(0.075, 0.125, 0.227);
const SOFT = rgb(0.34, 0.38, 0.48);
const RED = rgb(0.83, 0.14, 0.17);
const RULE = rgb(0.76, 0.8, 0.86);

// Standard PDF fonts only cover WinAnsi; replace what they can't draw.
const clean = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/×/g, "x")
    .replace(/[^\x20-\x7E -ÿ]/g, "");

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = clean(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export async function briefPdf(d: Dispute, brief: Brief, exhibits: Exhibit[], invoiceId?: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Response to ${d.dispute_id}`);
  doc.setAuthor(SHOP.name);
  doc.setProducer("Exhibit");
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612;
  const H = 792;
  const M = 64;
  let bates = 0;

  const stamp = (page: PDFPage) => {
    bates++;
    const label = `HC-${String(bates).padStart(6, "0")}`;
    page.drawText(label, { x: W - M - sansBold.widthOfTextAtSize(label, 9), y: 36, size: 9, font: sansBold, color: RED });
    page.drawText(clean(`${SHOP.name} · ${d.dispute_id}`), { x: M, y: 36, size: 8, font: sans, color: SOFT });
  };

  // Page 1: the response.
  let page = doc.addPage([W, H]);
  let y = H - M;
  page.drawText(clean(SHOP.name), { x: M, y, size: 11, font: sansBold, color: INK });
  page.drawText(clean(`${SHOP.returnAddress.address_line_1}, ${SHOP.returnAddress.admin_area_2}, ${SHOP.returnAddress.admin_area_1}`), {
    x: M,
    y: y - 14,
    size: 9,
    font: sans,
    color: SOFT,
  });
  y -= 52;
  page.drawText(clean(`Response to PayPal case ${d.dispute_id}`), { x: M, y, size: 16, font: sansBold, color: INK });
  y -= 20;
  const meta = `${reasonLabel(d.reason)} · ${usd(d.dispute_amount.value)} disputed${invoiceId ? ` · store order ${invoiceId}` : ""} · ${day(brief.createdAt)}`;
  page.drawText(clean(meta), { x: M, y, size: 9.5, font: sans, color: SOFT });
  y -= 16;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: RULE });
  y -= 26;

  for (const s of brief.sentences.filter((x) => x.kept)) {
    const mark = ` [${s.cites.join(", ")}]`;
    const lines = wrap(s.text + mark, serif, 12, W - 2 * M);
    for (const l of lines) {
      if (y < 80) {
        stamp(page);
        page = doc.addPage([W, H]);
        y = H - M;
      }
      page.drawText(l, { x: M, y, size: 12, font: serif, color: INK, lineHeight: 17 });
      y -= 17;
    }
    y -= 6;
  }
  y -= 10;
  page.drawText("Exhibits", { x: M, y, size: 10, font: sansBold, color: INK });
  y -= 15;
  for (const e of exhibits) {
    if (y < 80) break;
    page.drawText(clean(`${e.id}  ${e.title}`), { x: M, y, size: 9.5, font: sans, color: INK });
    y -= 13;
  }
  y -= 14;
  page.drawText(clean(`${SHOP.owner}, ${SHOP.name} · ${SHOP.email}`), { x: M, y: Math.max(y, 60), size: 9.5, font: sans, color: SOFT });
  stamp(page);

  // One page per exhibit.
  for (const e of exhibits) {
    page = doc.addPage([W, H]);
    y = H - M;
    page.drawRectangle({ x: M, y: y - 6, width: 64, height: 22, color: rgb(0.17, 0.39, 0.91) });
    page.drawText(`Exhibit ${e.id}`, { x: M + 8, y: y + 1, size: 10, font: sansBold, color: rgb(1, 1, 1) });
    y -= 34;
    for (const l of wrap(e.title, sansBold, 14, W - 2 * M)) {
      page.drawText(l, { x: M, y, size: 14, font: sansBold, color: INK });
      y -= 18;
    }
    page.drawText(clean(e.source), { x: M, y, size: 8.5, font: sans, color: SOFT });
    y -= 22;
    for (const f of e.facts) {
      if (y < 90) break;
      page.drawText(clean(f.label), { x: M, y, size: 9.5, font: sans, color: SOFT });
      const lines = wrap(f.value, sans, 10, W - 2 * M - 150);
      for (const l of lines) {
        page.drawText(l, { x: M + 150, y, size: 10, font: sans, color: INK });
        y -= 14;
      }
      y -= 3;
    }
    if (e.lines?.length) {
      y -= 8;
      for (const t of e.lines) {
        for (const l of wrap(t, serif, 11, W - 2 * M)) {
          if (y < 90) break;
          page.drawText(l, { x: M, y, size: 11, font: serif, color: INK });
          y -= 15;
        }
        y -= 5;
      }
    }
    if (e.sandbox && y > 100) {
      y -= 8;
      for (const l of wrap(`Note: ${e.sandbox}`, sans, 8.5, W - 2 * M)) {
        page.drawText(l, { x: M, y, size: 8.5, font: sans, color: SOFT });
        y -= 12;
      }
    }
    stamp(page);
  }
  return doc.save();
}
