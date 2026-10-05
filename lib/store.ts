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
  return { rec: JSON.parse(await new Response(r.stream).text()) as CaseRecord, etag: r.blob.etag };
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
}

/**
 * Read-modify-write with an ETag check. `fn` returns the new record, or null to leave it alone (for example
 * when someone else already claimed it). Returns the record as written, or null.
 */
export async function updateCase(id: string, fn: (rec: CaseRecord) => CaseRecord | null): Promise<CaseRecord | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = await readRaw(id);
    if (!cur) return null;
    const next = fn(structuredClone(cur.rec));
    if (!next) return null;
    try {
      await writeRaw(next, cur.etag);
      return next;
    } catch {
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1) + Math.random() * 100));
    }
  }
  throw new Error("Couldn't save the case: it kept changing underneath us. Try again.");
}

/** Every case record Exhibit holds, newest first. */
export async function listCases(): Promise<CaseRecord[]> {
  let recs: CaseRecord[] = [];
  if (!useBlob()) {
    const files = await fs.readdir(LOCAL_DIR).catch(() => [] as string[]);
    recs = await Promise.all(files.filter((f) => f.endsWith(".json")).map(async (f) => JSON.parse(await fs.readFile(path.join(LOCAL_DIR, f), "utf8")) as CaseRecord));
  } else {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: "cases/", cursor, limit: 1000 });
      ids.push(...page.blobs.map((b) => b.pathname.slice(6, -5)));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    recs = (await Promise.all(ids.map((id) => loadCase(id).catch(() => null)))).filter((r): r is CaseRecord => Boolean(r));
  }
  return recs.sort((a, b) => b.openedAt.localeCompare(a.openedAt));
}
