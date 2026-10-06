import "server-only";
import { get, list, put } from "@vercel/blob";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { CaseRecord } from "./cases/types";

/**
 * One JSON document per case: Exhibit's own notes on a PayPal dispute (which scenario opened it, the order and
 * capture behind it, the brief, and everything filed). PayPal stays the source of truth for the dispute itself.
 * In production it's a private Vercel Blob written with an ETag check; locally, a file under .data/.
 */
const useBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const LOCAL_DIR = path.join(process.cwd(), ".data", "cases");
const key = (id: string) => `cases/${id}.json`;
export const CASE_ID = /^PP-[A-Z0-9-]{4,40}$/;

async function readRaw(id: string): Promise<{ rec: CaseRecord; etag?: string } | null> {
  if (!CASE_ID.test(id)) return null;
  if (!useBlob()) {
    try {
      return { rec: JSON.parse(await fs.readFile(path.join(LOCAL_DIR, `${id}.json`), "utf8")) };
    } catch {
      return null;
    }
  }
  const r = await get(key(id), { access: "private", useCache: false }).catch(() => null);
  if (!r?.stream) return null;
  return { rec: JSON.parse(await new Response(r.stream).text()) as CaseRecord, etag: strong(r.blob.etag) };
}

/** Larger (compressed) reads come back with a weak ETag, W/"…"; If-Match needs the strong form or it never matches. */
const strong = (etag?: string) => etag?.replace(/^W\//, "");

/*
 * The case index: every record in one blob, so listing the cases (the pool job runs every ten minutes) is one
 * read instead of one per case. Every write below keeps it current; if it's missing it is rebuilt from the cases.
 */
const INDEX = "index/cases.json";

async function readIndex(): Promise<{ recs: CaseRecord[]; etag?: string } | null> {
  const r = await get(INDEX, { access: "private", useCache: false }).catch(() => null);
  if (!r?.stream) return null;
  return { recs: (JSON.parse(await new Response(r.stream).text()) as { recs: CaseRecord[] }).recs, etag: strong(r.blob.etag) };
}

function writeIndex(recs: CaseRecord[], etag?: string) {
  return put(INDEX, JSON.stringify({ at: new Date().toISOString(), recs }), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    ...(etag ? { ifMatch: etag } : {}),
  });
}

/** Puts one record into the index (ETag-checked, retried; a conflict means another write landed first). */
async function indexCase(rec: CaseRecord): Promise<void> {
  if (!useBlob()) return;
  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = await readIndex();
    if (!cur) {
      await rebuildIndex();
      return;
    }
    const recs = [rec, ...cur.recs.filter((r) => r.disputeId !== rec.disputeId)];
    try {
      await writeIndex(recs, cur.etag);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1) + Math.random() * 150));
    }
  }
  // Still conflicting: rebuild from the case blobs themselves, which are the source of truth.
  await rebuildIndex();
}

async function rebuildIndex(): Promise<CaseRecord[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: "cases/", cursor, limit: 1000 });
    ids.push(...page.blobs.map((b) => b.pathname.slice(6, -5)));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const recs = (await Promise.all(ids.map((id) => loadCase(id).catch(() => null)))).filter((r): r is CaseRecord => Boolean(r));
  await writeIndex(recs);
  return recs;
}

async function writeRaw(rec: CaseRecord, etag?: string): Promise<void> {
  if (!useBlob()) {
    await fs.mkdir(LOCAL_DIR, { recursive: true });
    await fs.writeFile(path.join(LOCAL_DIR, `${rec.disputeId}.json`), JSON.stringify(rec, null, 2));
    return;
  }
  await put(key(rec.disputeId), JSON.stringify(rec), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    ...(etag ? { ifMatch: etag } : {}),
  });
}

export async function loadCase(id: string): Promise<CaseRecord | null> {
  return (await readRaw(id))?.rec ?? null;
}

export async function saveCase(rec: CaseRecord): Promise<void> {
  await writeRaw(rec);
  await indexCase(rec);
  memo = null;
}

/**
 * Read-modify-write with an ETag check. `fn` returns the new record, or null to leave it alone (for example
 * when someone else already claimed it). Returns the record as written, or null.
 */
export async function updateCase(id: string, fn: (rec: CaseRecord) => CaseRecord | null): Promise<CaseRecord | null> {
  // A conflict means someone else wrote first: re-read and retry, then write the freshly read record unconditionally.
  const ATTEMPTS = 5;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const cur = await readRaw(id);
    if (!cur) return null;
    const next = fn(structuredClone(cur.rec));
    if (!next) return null;
    const last = attempt === ATTEMPTS - 1;
    try {
      await writeRaw(next, last ? undefined : cur.etag);
      await indexCase(next);
      memo = null;
      return next;
    } catch (e) {
      if (last) throw new Error(`Couldn't save the case (${(e as Error).message}). Try again.`);
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1) + Math.random() * 150));
    }
  }
  return null;
}

let memo: { at: number; recs: CaseRecord[] } | null = null;

/** Every case record Exhibit holds, newest first. Remembered for ten seconds unless `fresh`. */
export async function listCases(fresh = false): Promise<CaseRecord[]> {
  if (!fresh && memo && Date.now() - memo.at < 10_000) return memo.recs;
  let recs: CaseRecord[] = [];
  if (!useBlob()) {
    const files = await fs.readdir(LOCAL_DIR).catch(() => [] as string[]);
    recs = await Promise.all(files.filter((f) => f.endsWith(".json")).map(async (f) => JSON.parse(await fs.readFile(path.join(LOCAL_DIR, f), "utf8")) as CaseRecord));
  } else {
    recs = (await readIndex())?.recs ?? (await rebuildIndex());
  }
  recs.sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  memo = { at: Date.now(), recs };
  return recs;
}
