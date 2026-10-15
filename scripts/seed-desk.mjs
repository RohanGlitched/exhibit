// Gives the live desk a history by working cases through the site's own public API, exactly as a visitor
// would: open a case from a story, argue it (the model writes the brief), file what the brief recommends (or
// override it), then, once PayPal opens the case for a ruling, ask the sandbox to rule.
//
//   node scripts/seed-desk.mjs stale            argue + file every shop case close to its deadline that nobody answered
//   node scripts/seed-desk.mjs claim <story> [n] open n cases of a story, argue and file them
//   node scripts/seed-desk.mjs rule [max]       ask for a ruling on filed cases PayPal has opened for one
//   node scripts/seed-desk.mjs case <id>        argue and file one case
//   node scripts/seed-desk.mjs status           the desk, as counts
//
// Paced to stay inside the site's per-visitor limits (a model brief a minute). BASE defaults to production.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "https://exhibit-desk.vercel.app";
const JAR = process.env.JAR ?? ".data/seed-cookie.txt";
const OVERRIDE = new Set((process.env.FIGHT_ANYWAY ?? "").split(",").filter(Boolean)); // case ids to fight against the advice
const SKIP = new Set((process.env.SKIP ?? "").split(",").filter(Boolean)); // case ids to leave unanswered
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

let cookie = "";
try {
  cookie = readFileSync(JAR, "utf8").trim();
} catch {}

async function call(path, init = {}) {
  const res = await fetch(BASE + path, { ...init, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) } });
  const set = res.headers.get("set-cookie");
  if (set) {
    cookie = set.split(";")[0];
    mkdirSync(".data", { recursive: true });
    writeFileSync(JAR, cookie);
  }
  return res;
}

async function rows() {
  const r = await call("/api/cases");
  return (await r.json()).rows;
}

async function argue(id) {
  const res = await call(`/api/cases/${id}/argue?paced=0`, { method: "POST" });
  if (!res.ok) throw new Error(`argue ${res.status} ${await res.text()}`);
  const text = await res.text();
  const events = text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const err = events.find((e) => e.type === "error");
  if (err) throw new Error(err.text);
  const brief = events.find((e) => e.type === "brief")?.brief;
  if (!brief) throw new Error("no brief");
  return brief;
}

async function file(id, action) {
  const res = await call(`/api/cases/${id}/file`, { method: "POST", body: JSON.stringify({ action }) });
  const j = await res.json();
  if (!res.ok) throw new Error(`${action}: ${j.error}`);
  return j.filing;
}

async function work(id) {
  const brief = await argue(id);
  const kept = brief.sentences.filter((s) => s.kept).length;
  log(id, `${brief.engine}${brief.model ? ` (${brief.model})` : ""}`, brief.recommendation, `${brief.odds}%`, `${kept}/${brief.sentences.length} kept`, brief.headline);
  const action = OVERRIDE.has(id) ? "evidence" : brief.recommendation === "accept" ? "accept" : "evidence";
  const f = await file(id, action);
  log(id, OVERRIDE.has(id) ? "fought against the advice:" : "filed:", f.summary);
}

const [cmd, arg, n] = process.argv.slice(2);

if (cmd === "status") {
  const all = await rows();
  const count = {};
  for (const r of all) {
    const k = `${r.source}/${r.pooled ? "pool" : r.retired ? "retired" : r.where}`;
    count[k] = (count[k] ?? 0) + 1;
  }
  console.log(count);
} else if (cmd === "case") {
  // Argue and file one case by id.
  await work(arg);
} else if (cmd === "stale") {
  // Shop cases waiting on the seller, inside two days of the deadline, that nobody has argued.
  const all = await rows();
  const todo = all.filter((r) => r.source !== "probe" && !r.pooled && r.where === "waiting" && r.odds === null && r.due && new Date(r.due) - Date.now() < 2 * 86_400_000 && !SKIP.has(r.id));
  log(`${todo.length} stale cases`);
  for (const r of todo) {
    try {
      await work(r.id);
    } catch (e) {
      log(r.id, "FAILED", e.message);
    }
    await pause(65_000);
  }
} else if (cmd === "claim") {
  for (let i = 0; i < Number(n ?? 1); i++) {
    const res = await call("/api/cases", { method: "POST", body: JSON.stringify({ scenario: arg }) });
    const j = await res.json();
    if (!res.ok) {
      log("open failed", j.error);
      break;
    }
    log("opened", j.id, j.ready ? "(ready from the pool)" : "(fresh: PayPal is reviewing it)");
    if (!j.ready) {
      // Wait for PayPal to hand it to the seller.
      for (let t = 0; t < 30; t++) {
        await pause(30_000);
        const v = await (await call(`/api/cases/${j.id}`)).json();
        if (v.status === "WAITING_FOR_SELLER_RESPONSE") break;
      }
    }
    try {
      await work(j.id);
    } catch (e) {
      log(j.id, "FAILED", e.message);
    }
    await pause(65_000);
  }
} else if (cmd === "rule") {
  const all = await rows();
  const filed = all.filter((r) => r.source !== "probe" && (r.where === "filed" || (r.where === "refunded" && r.status !== "RESOLVED")));
  let done = 0;
  for (const r of filed) {
    if (done >= Number(arg ?? 99)) break;
    const v = await (await call(`/api/cases/${r.id}`)).json();
    if (!v.actions?.includes("adjudicate") || v.filings?.some((f) => f.action === "ruling")) continue;
    try {
      const f = await file(r.id, "ruling");
      log(r.id, f.summary);
      done++;
    } catch (e) {
      log(r.id, "ruling failed", e.message);
    }
    await pause(8_000);
  }
  log(`${done} rulings requested`);
} else {
  console.log("usage: stale | claim <story> [n] | rule [max] | status");
}
