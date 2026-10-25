import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream, type PDFObject } from "pdf-lib";
import { splitFiled } from "./derive";

/**
 * Reads the text back out of the PDF Exhibit files with PayPal, so the simulated reviewer reads what PayPal
 * holds and nothing else. The PDF is drawn by lib/cases/pdf.ts with the standard fonts, so every line is one
 * text operator with a WinAnsi string; this decodes those, page by page, in drawing order. Pure: it takes
 * bytes, so it works the same on PayPal's copy and on a PDF rendered in a test.
 */

/** WinAnsi differs from Latin-1 only in 0x80-0x9F. */
const WIN: Record<number, string> = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž",
  0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};
const winAnsi = (bytes: number[]) => bytes.map((b) => WIN[b] ?? String.fromCharCode(b)).join("");

function hexString(h: string): string {
  const clean = h.replace(/\s+/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2).padEnd(2, "0"), 16));
  return winAnsi(bytes);
}

function literalString(s: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") {
      bytes.push(c.charCodeAt(0));
      continue;
    }
    const n = s[++i];
    const esc: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
    if (n in esc) bytes.push(esc[n]);
    else if (/[0-7]/.test(n)) {
      let oct = n;
      while (oct.length < 3 && /[0-7]/.test(s[i + 1] ?? "")) oct += s[++i];
      bytes.push(parseInt(oct, 8));
    }
  }
  return winAnsi(bytes);
}

/** The lines drawn on each page, in order. */
export async function pdfLines(bytes: Uint8Array): Promise<string[][]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.getPages().map((page) => {
    const contents = page.node.Contents();
    const streams: PDFObject[] = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)!) : contents ? [contents] : [];
    const lines: string[] = [];
    for (const s of streams) {
      if (!(s instanceof PDFRawStream)) continue;
      const ops = Buffer.from(decodePDFRawStream(s).decode()).toString("latin1");
      for (const m of ops.matchAll(/<([0-9A-Fa-f\s]*)>\s*Tj|\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
        const t = m[1] !== undefined ? hexString(m[1]) : literalString(m[2]);
        if (t.trim()) lines.push(t);
      }
    }
    return lines;
  });
}

export interface FiledRecord {
  /** The response as written on the first page(s), split back into its cited sentences. */
  response: { text: string; cites: string[] }[];
  /** Every page, labelled with the Bates number stamped on it. */
  pages: { bates: string; text: string }[];
  /** Only the exhibit pages (each starts "Exhibit X"). */
  exhibitPages: { bates: string; exhibit: string; text: string }[];
}

const BATES = /^HC-\d{6}$/;

/** The record as the PDF holds it: the response sentences and the Bates-stamped pages. */
export function filedRecord(pages: string[][]): FiledRecord {
  const labelled = pages.map((lines, i) => {
    const bates = lines.find((l) => BATES.test(l.trim()))?.trim() ?? `page ${i + 1}`;
    // The footer on every page is "<shop> · <case id>"; it says nothing to a reviewer.
    const body = lines.filter((l) => !BATES.test(l.trim()) && !/^.{3,60} · PP-[A-Z0-9-]+$/.test(l.trim()));
    return { bates, lines: body };
  });
  const firstExhibit = labelled.findIndex((p) => /^Exhibit [A-Z]$/.test(p.lines[0] ?? ""));
  const front = (firstExhibit < 0 ? labelled : labelled.slice(0, firstExhibit)).flatMap((p) => p.lines);
  // Front matter: shop, address, title, meta line; then the response until the "Exhibits" index.
  const start = front.findIndex((l) => /^Response to PayPal case /.test(l));
  const end = front.indexOf("Exhibits");
  const body = front.slice(start >= 0 ? start + 2 : 0, end >= 0 ? end : undefined).join(" ");
  const response = splitFiled(body).filter((s) => s.text.length > 0);
  const exhibitPages: FiledRecord["exhibitPages"] = [];
  for (const p of firstExhibit < 0 ? [] : labelled.slice(firstExhibit)) {
    if (/^Exhibit [A-Z]$/.test(p.lines[0] ?? "")) exhibitPages.push({ bates: p.bates, exhibit: p.lines[0].slice(-1), text: p.lines.join("\n") });
    // A long exhibit runs on to the next page, stamped with its own number.
    else if (exhibitPages.length) exhibitPages[exhibitPages.length - 1].text += `\n(continued on ${p.bates})\n${p.lines.join("\n")}`;
  }
  return { response, pages: labelled.map((p) => ({ bates: p.bates, text: p.lines.join("\n") })), exhibitPages };
}
