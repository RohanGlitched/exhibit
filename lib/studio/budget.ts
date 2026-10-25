import "server-only";
import { storage } from "../storage";

/**
 * The analytics analyst's own daily budget, apart from the briefs' (lib/budget.ts), so a busy dashboard can't
 * starve a judge's brief of model time. It counts model turns (one question is several: the analyst's own and
 * those of Studio's agents it hands work to). ANALYST_DAILY_TURNS sets the cap, default 300 a day, about four
 * dollars of Claude Haiku 4.5 at the most. Counted in memory and flushed to the shared store every 10 turns
 * (every turn once 80% is spent), so the cap holds across instances.
 */
const CAP = Number(process.env.ANALYST_DAILY_TURNS || 300);
const FLUSH_EVERY = 10;

let day = "";
let persisted = 0;
let local = 0;

const today = () => new Date().toISOString().slice(0, 10);
const key = (d: string) => `usage/analyst-${d}.json`;

async function readCount(d: string): Promise<{ count: number; etag?: string }> {
  const s = storage();
  if (!s) return { count: 0 };
  const r = await s.read(key(d)).catch(() => null);
  if (!r) return { count: 0 };
  return { count: (JSON.parse(r.text) as { count?: number }).count ?? 0, etag: r.etag };
}

async function flush(): Promise<void> {
  const s = storage();
  if (!s || local === 0) return;
  for (let i = 0; i < 3; i++) {
    const cur = await readCount(day);
    try {
      await s.write(key(day), JSON.stringify({ count: cur.count + local }), { ifMatch: cur.etag });
      persisted = cur.count + local;
      local = 0;
      return;
    } catch {
      /* another instance wrote first: re-read and retry */
    }
  }
}

/** Takes one analyst turn from today's budget; false once the day's cap is spent. */
export async function takeAnalystTurn(): Promise<boolean> {
  const d = today();
  if (d !== day) {
    const count = (await readCount(d).catch(() => ({ count: 0 }))).count;
    if (d !== day) {
      day = d;
      local = 0;
      persisted = count;
    }
  }
  if (persisted + local >= CAP) return false;
  local++;
  if (local >= FLUSH_EVERY || persisted + local >= CAP * 0.8) await flush().catch(() => {});
  return true;
}
