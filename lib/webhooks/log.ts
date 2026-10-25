import "server-only";
import { storage } from "../storage";

/**
 * The last hundred PayPal webhook deliveries Exhibit verified, newest first, in one small document. Appends are
 * version-checked (the same ETag compare-and-swap as the case index), so two deliveries landing at once both
 * stay. Without a store (a dev server) the log lives in memory.
 */
export interface WebhookLogEntry {
  id: string; // PayPal's event id, WH-…
  type: string;
  receivedAt: string;
  disputeId: string | null;
  /** What Exhibit did, in a sentence. */
  did: string;
  ok: boolean;
  ms: number;
}

const KEY = "webhooks/log.json";
const KEEP = 100;
let memory: WebhookLogEntry[] = [];

async function read(): Promise<{ entries: WebhookLogEntry[]; etag?: string }> {
  const s = storage();
  if (!s) return { entries: memory };
  const r = await s.read(KEY);
  if (!r) return { entries: [] };
  return { entries: (JSON.parse(r.text) as { entries: WebhookLogEntry[] }).entries ?? [], etag: r.etag };
}

export async function readWebhookLog(): Promise<WebhookLogEntry[]> {
  return (await read().catch(() => ({ entries: [] as WebhookLogEntry[] }))).entries;
}

/** Whether a delivery with this event id was already handled (PayPal redelivers until it gets a 2xx). */
export async function handledEvent(id: string): Promise<boolean> {
  return (await readWebhookLog()).some((e) => e.id === id && e.ok);
}

export async function appendWebhookLog(entry: WebhookLogEntry): Promise<void> {
  const s = storage();
  const merge = (cur: WebhookLogEntry[]) => [entry, ...cur.filter((e) => e.id !== entry.id)].slice(0, KEEP);
  if (!s) {
    memory = merge(memory);
    return;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await read().catch(() => null);
    if (!cur) break;
    try {
      await s.write(KEY, JSON.stringify({ at: new Date().toISOString(), entries: merge(cur.entries) }), { ifMatch: cur.etag });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1) + Math.random() * 150));
    }
  }
  console.error("webhook log: couldn't append", entry.id);
}

/** The log in a few numbers, for /api/health. */
export function webhookSummary(entries: WebhookLogEntry[], now = Date.now()) {
  const last = entries[0];
  return {
    configured: Boolean(process.env.PAYPAL_WEBHOOK_ID),
    logged: entries.length,
    argued: entries.filter((e) => e.did.startsWith("Argued")).length,
    failed: entries.filter((e) => !e.ok).length,
    lastAt: last?.receivedAt ?? null,
    lastHours: last ? Math.round(((now - new Date(last.receivedAt).getTime()) / 3_600_000) * 10) / 10 : null,
    recent: entries.slice(0, 5).map(({ id, type, receivedAt, disputeId, did, ok, ms }) => ({ id, type, receivedAt, disputeId, did, ok, ms })),
  };
}
