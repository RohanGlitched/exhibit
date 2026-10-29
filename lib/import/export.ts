/**
 * Reads an order export a seller pastes: a CSV with a header row (one row per order, or one per line item as
 * Shopify and WooCommerce export them) or a JSON order (Shopify, WooCommerce, PayPal Orders v2 or flat). Out
 * comes the order form, filled in as far as the export goes; the seller checks it before Exhibit builds
 * anything. Safe to import from client code.
 */

export interface OrderFields {
  id: string;
  date: string;
  items: string; // one item per line, as the form takes them
  total: string;
  shipTo: string;
  buyer: string;
  email: string;
}

export interface ExportResult {
  fields: Partial<OrderFields>;
  read: (keyof OrderFields)[]; // which fields the export filled
  format: "CSV" | "JSON";
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Header names (and JSON keys) for each field, compared without case, spaces or punctuation. */
const ALIASES: Record<string, string[]> = {
  id: ["orderid", "ordernumber", "orderno", "order", "name", "number", "invoice", "invoiceid", "invoicenumber", "id", "reference", "ref"],
  date: ["createdat", "orderdate", "date", "datecreated", "createtime", "created", "paidat", "processedat", "placedat", "purchasedate"],
  total: ["total", "totalprice", "ordertotal", "grandtotal", "amount", "gross", "totalamount", "value"],
  email: ["email", "buyeremail", "customeremail", "emailaddress", "billingemail", "payeremail"],
  buyer: ["billingname", "customername", "buyername", "customer", "buyer", "fullname", "payername"],
  shipName: ["shippingname", "shiptoname", "recipient", "recipientname"],
  ship1: ["shippingaddress1", "shippingaddressline1", "shippingstreet", "address1", "addressline1", "street"],
  ship2: ["shippingaddress2", "shippingaddressline2", "address2", "addressline2"],
  city: ["shippingcity", "city", "adminarea2"],
  state: ["shippingprovince", "shippingprovincecode", "shippingstate", "province", "provincecode", "state", "adminarea1"],
  zip: ["shippingzip", "shippingpostcode", "shippingpostalcode", "shippingzipcode", "zip", "postcode", "postalcode", "zipcode"],
  shipTo: ["shipto", "shippingaddress", "deliveryaddress"],
  itemName: ["lineitemname", "itemname", "productname", "item", "product", "title", "description"],
  itemQty: ["lineitemquantity", "quantity", "qty", "itemquantity"],
  itemPrice: ["lineitemprice", "itemprice", "unitprice", "price", "unitamount"],
  items: ["items", "lineitems", "products"],
};

/* ───────────── CSV ───────────── */

/** RFC 4180-ish: quoted fields with "" escapes and newlines; commas, or tabs when the header row has them. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
  const firstLine = t.split("\n")[0] ?? "";
  const sep = firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) {
      row.push(cell.trim());
      cell = "";
    } else if (c === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell.trim());
  rows.push(row);
  return rows.filter((r) => r.some((c) => c !== ""));
}

function fromCsv(text: string): ExportResult | { error: string } {
  const rows = parseCsv(text);
  if (rows.length < 2) return { error: "The CSV needs a header row and at least one order row." };
  const head = rows[0].map(key);
  const col = (field: string) => {
    for (const a of ALIASES[field]) {
      const i = head.indexOf(a);
      if (i >= 0) return i;
    }
    return -1;
  };
  const cols = Object.fromEntries(Object.keys(ALIASES).map((f) => [f, col(f)])) as Record<string, number>;
  const data = rows.slice(1);
  // Several rows are one order's line items when they share the order column (or when there is none).
  const firstId = cols.id >= 0 ? data[0][cols.id] : "";
  const mine = cols.id >= 0 ? data.filter((r) => !r[cols.id] || r[cols.id] === firstId) : data.slice(0, 1);
  const get = (field: string) => {
    const i = cols[field];
    if (i < 0) return "";
    return mine.map((r) => r[i] ?? "").find((v) => v) ?? "";
  };
  const items = cols.itemName >= 0
    ? mine
        .filter((r) => r[cols.itemName])
        .map((r) => {
          const q = cols.itemQty >= 0 ? r[cols.itemQty] : "";
          const p = cols.itemPrice >= 0 ? r[cols.itemPrice] : "";
          return `${q && /^\d+$/.test(q) ? `${q} × ` : ""}${r[cols.itemName]}${p ? `, ${/^[\d.,]+$/.test(p) ? `$${p}` : p}` : ""}`;
        })
        .join("\n")
    : "";
  return finish(
    { id: get("id"), date: get("date"), total: get("total"), email: get("email"), buyer: get("buyer"), items, shipTo: get("shipTo") },
    { name: get("shipName"), line1: get("ship1"), line2: get("ship2"), city: get("city"), state: get("state"), zip: get("zip") },
    "CSV",
  );
}

/* ───────────── JSON ───────────── */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const prim = (v: unknown): string => {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (isObj(v) && ("value" in v || "amount" in v)) return prim(v.value ?? v.amount); // {"currency_code": "USD", "value": "46.00"}
  return "";
};

/** The first value under one of `names`, at the top level first, then one and two levels down. */
function find(o: Obj, names: string[], depth = 2): string {
  for (const n of names) {
    for (const [k, v] of Object.entries(o)) if (key(k) === n && prim(v)) return prim(v);
  }
  if (depth === 0) return "";
  for (const v of Object.values(o)) {
    const inner = isObj(v) ? v : Array.isArray(v) && isObj(v[0]) ? v[0] : null;
    if (!inner) continue;
    const got = find(inner, names, depth - 1);
    if (got) return got;
  }
  return "";
}
function child(o: Obj, names: string[]): Obj | null {
  for (const [k, v] of Object.entries(o)) if (names.includes(key(k)) && isObj(v)) return v;
  return null;
}
function list(o: Obj, names: string[], depth = 2): Obj[] {
  for (const [k, v] of Object.entries(o)) if (names.includes(key(k)) && Array.isArray(v)) return v.filter(isObj);
  if (depth === 0) return [];
  for (const v of Object.values(o)) {
    const inner = isObj(v) ? v : Array.isArray(v) && isObj(v[0]) ? v[0] : null;
    if (!inner) continue;
    const got = list(inner, names, depth - 1);
    if (got.length) return got;
  }
  return [];
}

function fromJson(text: string): ExportResult | { error: string } {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { error: "That looks like JSON but doesn't parse. Check for a missing comma or quote." };
  }
  const o = Array.isArray(v) ? v.find(isObj) : v;
  if (!isObj(o)) return { error: "The JSON needs to be one order: an object with fields like id, date and total." };
  // A wrapper ({"order": {...}}) is unwrapped.
  const order = child(o, ["order"]) ?? o;
  // PayPal Orders v2 keeps the money, items and shipping under purchase_units[0].
  const pu = Array.isArray(order.purchase_units) && isObj(order.purchase_units[0]) ? (order.purchase_units[0] as Obj) : null;
  const base = pu ? { ...order, ...pu } : order;

  const ship = child(base, ["shippingaddress", "shipping", "shipto", "delivery", "deliveryaddress"]);
  const shipAddr = ship ? (child(ship, ["address"]) ?? ship) : null;
  const shipName = ship
    ? find(ship, ["fullname", "name"], 1) || [find(ship, ["firstname"], 0), find(ship, ["lastname"], 0)].filter(Boolean).join(" ")
    : "";
  const billing = child(base, ["billing", "billingaddress", "customer", "payer", "buyer"]);
  const billName = billing
    ? [find(billing, ["firstname", "givenname"], 1), find(billing, ["lastname", "surname"], 1)].filter(Boolean).join(" ") || find(billing, ["fullname", "name"], 1)
    : "";

  const items = list(base, ["lineitems", "items", "products"])
    .map((it) => {
      const name = find(it, ["name", "title", "productname", "description"], 0);
      const q = find(it, ["quantity", "qty"], 0);
      const p = find(it, ["price", "unitprice", "unitamount", "amount"], 1);
      return name ? `${q ? `${q} × ` : ""}${name}${p ? `, $${p}` : ""}` : "";
    })
    .filter(Boolean)
    .join("\n");

  const total = find(base, ["totalprice", "total", "ordertotal", "grandtotal", "amount", "gross"], 1);
  return finish(
    {
      id: find(order, ["ordernumber", "orderid", "number", "name", "invoiceid", "invoice", "id"], 0) || find(base, ["invoiceid", "id"], 0),
      date: find(order, ALIASES.date, 0),
      total,
      email: find(base, ALIASES.email, 2),
      buyer: billName || find(base, ["customername", "buyername", "payername"], 1),
      items,
      shipTo: "",
    },
    {
      name: shipName,
      line1: shipAddr ? find(shipAddr, ["address1", "addressline1", "street", "line1"], 0) : "",
      line2: shipAddr ? find(shipAddr, ["address2", "addressline2", "line2"], 0) : "",
      city: shipAddr ? find(shipAddr, ["city", "adminarea2", "town"], 0) : "",
      state: shipAddr ? find(shipAddr, ["provincecode", "province", "state", "adminarea1", "region"], 0) : "",
      zip: shipAddr ? find(shipAddr, ["zip", "postcode", "postalcode", "zipcode"], 0) : "",
    },
    "JSON",
  );
}

/* ───────────── Both ───────────── */

function finish(
  f: Omit<OrderFields, "shipTo"> & { shipTo: string },
  addr: { name: string; line1: string; line2: string; city: string; state: string; zip: string },
  format: ExportResult["format"],
): ExportResult | { error: string } {
  const street = [addr.line1, addr.line2, addr.city, [addr.state, addr.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const shipTo = f.shipTo || (street ? [addr.name, street].filter(Boolean).join(", ") : "");
  const fields: Partial<OrderFields> = {
    id: f.id.replace(/^#/, "").slice(0, 40),
    date: f.date.slice(0, 40),
    total: f.total.slice(0, 20),
    email: f.email.slice(0, 120),
    buyer: (f.buyer || addr.name).slice(0, 80),
    items: f.items.slice(0, 2000),
    shipTo: shipTo.slice(0, 200),
  };
  const read = (Object.keys(fields) as (keyof OrderFields)[]).filter((k) => fields[k]);
  for (const k of Object.keys(fields) as (keyof OrderFields)[]) if (!fields[k]) delete fields[k];
  if (!read.length) return { error: `Exhibit read the ${format} but found none of the usual order fields (order id, date, total, items, ship-to).` };
  return { fields, read, format };
}

/** A pasted export, CSV or JSON, read into the order form. */
export function parseExport(text: string): ExportResult | { error: string } {
  const t = text.trim();
  if (!t) return { error: "Paste an order export first." };
  if (t.length > 20_000) return { error: "That export is over 20,000 characters. Paste just the one order." };
  return /^[[{]/.test(t) ? fromJson(t) : fromCsv(t);
}
