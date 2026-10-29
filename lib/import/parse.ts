/**
 * Parsers for a case a seller pastes in: dates and times as people and carriers write them, amounts, item
 * lines, carrier scan lines and an email thread. Everything comes out in the forms the exhibits use ("3 Oct
 * 2026, 14:14", "$46.00", "2 × Mug, $23.00"), so the brief checker matches pasted records the same way it
 * matches PayPal's. No time zones: a pasted time is kept as the seller wrote it. Safe to import from client code.
 */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_WORD = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec";
const monthIndex = (w: string) => {
  const k = w.toLowerCase().slice(0, 3);
  return MON.findIndex((m) => m.toLowerCase() === k);
};

export interface When {
  y: number;
  m: number; // 1..12
  d: number;
  h?: number;
  min?: number;
}

const valid = (w: When) => {
  if (w.m < 1 || w.m > 12 || w.d < 1 || w.y < 2000 || w.y > 2100) return false;
  const last = new Date(Date.UTC(w.y, w.m, 0)).getUTCDate();
  if (w.d > last) return false;
  if (w.h !== undefined && (w.h < 0 || w.h > 23 || (w.min ?? 0) < 0 || (w.min ?? 0) > 59)) return false;
  return true;
};

/** "3 Oct 2026" or "3 Oct 2026, 14:14", as every exhibit writes a date. */
export function fmtWhen(w: When): string {
  const date = `${w.d} ${MON[w.m - 1]} ${w.y}`;
  return w.h === undefined ? date : `${date}, ${String(w.h).padStart(2, "0")}:${String(w.min ?? 0).padStart(2, "0")}`;
}

/** Sortable number for a When (date, then time; an undated time sorts at the start of its day). */
export const whenKey = (w: When) => Date.UTC(w.y, w.m - 1, w.d, w.h ?? 0, w.min ?? 0);

// Each date form, with the parts it captures. Weekday names before a date ("Saturday, October 3") are left
// in the text around it and trimmed by the caller.
const DATE_FORMS: { re: RegExp; read: (m: RegExpMatchArray) => { y?: number; m: number; d: number } }[] = [
  { re: /\b(\d{4})-(\d{1,2})-(\d{1,2})(?=T|\b)/, read: (m) => ({ y: +m[1], m: +m[2], d: +m[3] }) },
  { re: /\b(\d{4})\/(\d{1,2})\/(\d{1,2})\b/, read: (m) => ({ y: +m[1], m: +m[2], d: +m[3] }) },
  // 10/03/2026 is read the US way (month first) unless the first number can't be a month.
  { re: /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4}|\d{2})\b/, read: (m) => {
      const a = +m[1], b = +m[2], y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      return a > 12 ? { y, m: b, d: a } : { y, m: a, d: b };
    } },
  { re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[ -](?:of )?(${MONTH_WORD})\\.?,?[ -](\\d{4})\\b`, "i"), read: (m) => ({ y: +m[3], m: monthIndex(m[2]) + 1, d: +m[1] }) },
  { re: new RegExp(`\\b(${MONTH_WORD})\\.? (\\d{1,2})(?:st|nd|rd|th)?,? (\\d{4})\\b`, "i"), read: (m) => ({ y: +m[3], m: monthIndex(m[1]) + 1, d: +m[2] }) },
  // No year: the caller supplies the year the case happened in.
  { re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (?:of )?(${MONTH_WORD})\\b\\.?`, "i"), read: (m) => ({ m: monthIndex(m[2]) + 1, d: +m[1] }) },
  { re: new RegExp(`\\b(${MONTH_WORD})\\.? (\\d{1,2})(?:st|nd|rd|th)?\\b(?!:)`, "i"), read: (m) => ({ m: monthIndex(m[1]) + 1, d: +m[2] }) },
];
const TIME_FORMS: { re: RegExp; read: (m: RegExpMatchArray) => { h: number; min: number } }[] = [
  { re: /\b(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s?([ap])\.?\s?m\b\.?/i, read: (m) => ({ h: (+m[1] % 12) + (m[3].toLowerCase() === "p" ? 12 : 0), min: +(m[2] ?? 0) }) },
  { re: /(?:\bT|\b)(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:\s?(?:Z|UTC|GMT|[+-]\d{2}:?\d{2}|[ECMP][SD]T)\b)?(?!\d)/, read: (m) => ({ h: +m[1], min: +m[2] }) },
];
const WEEKDAY = /\b(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)(?:day|nesday|urday|sday)?\b\.?,?/gi;

export interface Found {
  when: When;
  rest: string; // the text with the date, the time and any weekday taken out
  hasYear: boolean;
}

/** Finds the first date (and a time near it) in a piece of text. `year` fills in a date written without one. */
export function findWhen(text: string, year?: number): Found | null {
  for (const form of DATE_FORMS) {
    const m = text.match(form.re);
    if (!m) continue;
    const p = form.read(m);
    const y = p.y ?? year;
    if (!y) continue;
    let rest = text.slice(0, m.index!) + " " + text.slice(m.index! + m[0].length);
    const w: When = { y, m: p.m, d: p.d };
    for (const tf of TIME_FORMS) {
      const t = rest.match(tf.re);
      if (!t) continue;
      const hm = tf.read(t);
      w.h = hm.h;
      w.min = hm.min;
      rest = rest.slice(0, t.index!) + " " + rest.slice(t.index! + t[0].length);
      break;
    }
    if (!valid(w)) {
      if (w.h !== undefined && valid({ y: w.y, m: w.m, d: w.d })) {
        delete w.h;
        delete w.min;
      } else continue;
    }
    rest = rest.replace(WEEKDAY, " ").replace(/\bat\s*$|^\s*at\b/gi, " ");
    return { when: w, rest, hasYear: p.y !== undefined };
  }
  return null;
}

/** A date the seller typed in a field: the whole value has to be one date (a time is allowed). */
export function parseDate(text: string, year?: number): When | null {
  const f = findWhen(text.trim(), year);
  if (!f) return null;
  return f.rest.replace(/[\s,.;:@-]+/g, "") === "" || /^\s*(?:at)?\s*$/i.test(f.rest) ? f.when : null;
}

/** An amount as "46.00", from "$46", "46.00 USD", "USD 1,046.50" or "€46,00" (a comma before two digits is a decimal). */
export function parseMoney(text: string): string | null {
  const t = text.trim().replace(/^(?:USD|US\$|\$|€|£)\s*/i, "").replace(/\s*(?:USD|dollars)$/i, "").trim();
  if (!/^\d[\d, ]*(?:[.,]\d{1,2})?$/.test(t)) return null;
  const decimal = /,\d{1,2}$/.test(t) && !/\./.test(t) ? t.replace(/[ .]/g, "").replace(",", ".") : t.replace(/[ ,]/g, "");
  const n = Number(decimal);
  return Number.isFinite(n) && n > 0 && n < 1_000_000 ? n.toFixed(2) : null;
}

/** "$1,046.50", as the exhibits write money. */
export const fmtUsd = (v: string | number) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
/** Separators left over once a date is taken out of a line: commas, pipes, dashes, tabs. */
const trimSeps = (s: string) => clean(s.replace(/\s*\t+\s*/g, ", ").replace(/\s[|·•]\s/g, ", ").replace(/,(?:\s*,)+/g, ",")).replace(/^[\s,;:|·•–—-]+|[\s,;:|·•–—-]+$/g, "");

/* ───────────── Items ───────────── */

export interface Item {
  quantity: number;
  name: string;
  price?: string; // each, as "23.00"
}

/** One item per line: "2 × Speckled mug, $23.00", "Speckled mug x2 @ 23.00", "Speckled mug — $46.00", "Speckled mug". */
export function parseItems(text: string): { items: Item[]; errors: string[] } {
  const items: Item[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  lines.forEach((raw, i) => {
    let line = raw.replace(/^[-*•]\s+/, "");
    let price: string | undefined;
    const p = line.match(/(?:^|[\s,@–—-])\s*((?:USD|US\$|\$|€|£)?\s?\d[\d,]*(?:\.\d{2})?)\s*(?:USD)?\s*(?:each|ea\.?|\/ea)?\s*$/i);
    // A trailing number is a price only when it is written as money or with cents, so "Tee size 10" keeps its 10.
    if (p && (/[$€£]|USD|\.\d{2}/i.test(p[1]) || /each|ea/i.test(p[0]))) {
      const v = parseMoney(p[1]);
      if (v) {
        price = v;
        line = line.slice(0, p.index!).replace(/[\s,@–—-]+$/, "");
      }
    }
    let quantity = 1;
    const lead = line.match(/^(\d{1,3})\s*(?:[x×*]|pcs?\b|units?\b)?\s+(.+)$/i);
    const trail = line.match(/^(.+?)\s*(?:[x×*]\s*(\d{1,3})|\((\d{1,3})\)|,?\s*qty:?\s*(\d{1,3}))$/i);
    if (lead) {
      quantity = +lead[1];
      line = lead[2];
    } else if (trail) {
      quantity = +(trail[2] ?? trail[3] ?? trail[4]);
      line = trail[1];
    }
    const name = line.replace(/^[,:;\s-]+|[,:;\s-]+$/g, "");
    if (!name) errors.push(`Item line ${i + 1} has no item name.`);
    else if (quantity < 1) errors.push(`Item line ${i + 1} has a quantity of 0.`);
    else items.push({ quantity, name: name.slice(0, 120), ...(price ? { price } : {}) });
  });
  return { items, errors };
}

export const itemLine = (it: Item) => `${it.quantity} × ${it.name}${it.price ? `, ${fmtUsd(it.price)}` : ""}`;

/* ───────────── Carrier scans ───────────── */

export interface Scan {
  when: When;
  status: string;
}

/** Carrier words written the way the requirements card and the checker read them. */
function tidyStatus(s: string): string {
  let t = s;
  // An all-capitals status ("DELIVERED, FRONT DOOR/PORCH") is lowered, keeping state codes and ZIPs.
  if (/[A-Z]{4,}/.test(t) && t === t.toUpperCase()) {
    t = t.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/, ([A-Z][a-z])\b(?= \d{5}|\s*$|,)/g, (_m, st) => `, ${st.toUpperCase()}`);
  }
  t = t.replace(/\bdelivered\b/gi, "Delivered").replace(/\bsigned for by\b/gi, "Signed for by");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Carrier scan lines, one per line with a date in each ("October 3, 2026, 2:14 pm  Delivered, Front Door,
 * PORTLAND, OR 97211"). Lines without a date are joined to the scan above (carriers often split a scan over
 * two lines). Returned oldest first, as the exhibits list them; carriers' pages usually list newest first.
 */
export function parseScans(text: string, year?: number): { scans: Scan[]; errors: string[]; notes: string[] } {
  const scans: Scan[] = [];
  const errors: string[] = [];
  const notes: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());
  let undatedYear = false;
  lines.forEach((line, i) => {
    const f = findWhen(line, year);
    if (!f) {
      const prev = scans[scans.length - 1];
      if (prev) prev.status = `${prev.status}. ${trimSeps(line)}`.replace(/\.\./g, ".");
      else errors.push(`Scan line ${i + 1} has no date Exhibit can read: “${clean(line).slice(0, 60)}”.`);
      return;
    }
    if (!f.hasYear) undatedYear = true;
    const status = trimSeps(f.rest);
    if (!status) {
      errors.push(`Scan line ${i + 1} has a date but no scan: “${clean(line).slice(0, 60)}”.`);
      return;
    }
    scans.push({ when: f.when, status: tidyStatus(status) });
  });
  if (undatedYear && year) notes.push(`Some scan lines had no year; Exhibit read them as ${year}, the year of the order.`);
  const sorted = scans.map((s, i) => ({ s, i })).sort((a, b) => whenKey(a.s.when) - whenKey(b.s.when) || a.i - b.i).map((x) => x.s);
  if (sorted.some((s, i) => s !== scans[i])) notes.push("The scans were listed newest first; the exhibit lists them oldest first.");
  return { scans: sorted, errors, notes };
}

export const scanLine = (s: Scan) => `${fmtWhen(s.when)}  ${s.status}`;

/* ───────────── Email thread ───────────── */

export interface Message {
  when?: When;
  from: "buyer" | "seller" | "other";
  name: string; // as shown in the exhibit
  text: string;
}

const HEADER = /^(From|Date|Sent|To|Cc|Bcc|Subject|Reply-To)\s*:\s*(.*)$/i;
const SELLER_WORDS = /^(?:me|seller|the seller|shop|the shop|store|us|we|support|customer service|owner)$/i;

/** Who a name or address in the thread is: the buyer (by name or email), the seller, or someone else. */
function whoIs(raw: string, buyer: { name?: string; email?: string }, seller?: string): Message["from"] {
  const r = raw.toLowerCase();
  const email = buyer.email?.toLowerCase();
  if (email && r.includes(email)) return "buyer";
  const parts = (buyer.name ?? "").toLowerCase().split(/\s+/).filter((p) => p.length > 1);
  const nameOnly = clean(r.replace(/<[^>]*>/g, "").replace(/["']/g, ""));
  if (parts.length && parts.some((p) => new RegExp(`\\b${p.replace(/[^a-z0-9]/g, "")}\\b`).test(nameOnly))) return "buyer";
  if (/^(?:buyer|customer|the buyer|the customer)$/.test(nameOnly)) return "buyer";
  if (SELLER_WORDS.test(nameOnly) || (seller && nameOnly.includes(seller.toLowerCase()))) return "seller";
  return "other";
}

const shownName = (raw: string, from: Message["from"], buyerName?: string) => {
  if (from === "buyer" && buyerName) return buyerName;
  if (from === "seller") return "Seller";
  const n = clean(raw.replace(/<[^>]*>/g, "").replace(/["']/g, ""));
  return (n || raw.replace(/[<>]/g, "")).slice(0, 60);
};

/** A message body: quoted replies (">" lines and everything after "On … wrote:") and signatures dropped. */
function body(lines: string[]): string {
  const out: string[] = [];
  for (const l of lines) {
    if (/^\s*>/.test(l)) continue;
    if (/^\s*On .{6,120} wrote:\s*$/i.test(l) || /^-{2,}\s*(?:Original Message|Forwarded message)/i.test(l)) break;
    if (/^\s*--\s*$/.test(l)) break;
    out.push(l.trim());
  }
  return clean(out.join(" "));
}

/**
 * An email thread pasted from a mail client or typed out. Two shapes are read:
 * - headers: each message starts with "From: …", with "Date: …" (and Subject, To…) before the body;
 * - one line per message: "5 Oct 2026, 09:12, Maya: …", "Maya (Oct 5, 9:12 am): …" or "Seller: …".
 * Anything else becomes one unattributed message, with a note. Messages come out oldest first.
 */
export function parseThread(
  text: string,
  who: { name?: string; email?: string; seller?: string; year?: number },
): { messages: Message[]; notes: string[] } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const notes: string[] = [];
  const messages: Message[] = [];
  const buyer = { name: who.name, email: who.email };

  if (lines.some((l) => /^\s*From\s*:/i.test(l))) {
    let cur: { from?: string; date?: string; lines: string[]; inHead: boolean } | null = null;
    const flush = () => {
      if (!cur) return;
      const t = body(cur.lines);
      if (t) {
        const from = whoIs(cur.from ?? "", buyer, who.seller);
        const f = cur.date ? findWhen(cur.date, who.year) : null;
        messages.push({ ...(f ? { when: f.when } : {}), from, name: shownName(cur.from ?? "Unknown sender", from, who.name), text: t });
      }
    };
    for (const l of lines) {
      const h = l.match(HEADER);
      if (h && h[1].toLowerCase() === "from") {
        flush();
        cur = { from: h[2], lines: [], inHead: true };
        continue;
      }
      if (!cur) continue; // text before the first From: line (a subject line, a forwarded banner)
      if (cur.inHead && h) {
        if (/^(?:date|sent)$/i.test(h[1])) cur.date = h[2];
        continue;
      }
      if (cur.inHead && !l.trim()) {
        cur.inHead = false;
        continue;
      }
      cur.inHead = false;
      cur.lines.push(l);
    }
    flush();
  } else {
    // "prefix: text", where the prefix holds a sender and maybe a date. A colon between digits is a time.
    const START = /^\s*((?:[^:\n]|(?<=\d):(?=\d))+?)\s*:\s+(.+)$/;
    let cur: Message | null = null;
    for (const l of lines) {
      const m = l.match(START);
      let started = false;
      if (m && m[1].length <= 90) {
        const f = findWhen(m[1], who.year);
        const name = clean((f ? f.rest : m[1]).replace(/[()[\]]/g, " ")).replace(/^[\s,;|–—-]+|[\s,;|–—-]+$/g, "");
        const words = name.split(/\s+/).filter(Boolean);
        if (name && name.length <= 48 && words.length <= 5 && (f || words.length <= 3) && !/[.!?]$/.test(name)) {
          if (cur) messages.push(cur);
          const from = whoIs(name, buyer, who.seller);
          cur = { ...(f ? { when: f.when } : {}), from, name: shownName(name, from, who.name), text: clean(m[2]) };
          started = true;
        }
      }
      if (!started) {
        if (cur && l.trim() && !/^\s*>/.test(l)) cur.text = clean(`${cur.text} ${l}`);
        else if (!cur && l.trim()) cur = { from: "other", name: "Unattributed", text: clean(l) };
      }
    }
    if (cur) messages.push(cur);
    if (messages.length === 1 && messages[0].name === "Unattributed") {
      notes.push("Exhibit couldn't tell who wrote the thread or when. Start each message with “From:” or a line like “5 Oct 2026, Maya: …”.");
    }
  }

  const undated = messages.filter((m) => !m.when).length;
  if (undated && messages.length) notes.push(`${undated} of ${messages.length} messages had no date Exhibit could read.`);
  // Mail clients often paste newest first. When every message is dated, list them oldest first.
  if (undated === 0 && messages.length > 1) {
    const sorted = messages.map((m, i) => ({ m, i })).sort((a, b) => whenKey(a.m.when!) - whenKey(b.m.when!) || a.i - b.i).map((x) => x.m);
    if (sorted.some((m, i) => m !== messages[i])) notes.push("The emails were pasted newest first; the exhibit lists them oldest first.");
    return { messages: sorted.map((m) => ({ ...m, text: m.text.slice(0, 1500) })), notes };
  }
  return { messages: messages.map((m) => ({ ...m, text: m.text.slice(0, 1500) })), notes };
}

export const messageLine = (m: Message) => `${m.when ? `${fmtWhen(m.when)}, ` : ""}${m.name}: ${m.text}`;
