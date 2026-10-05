import "server-only";

/** Sliding-window limits per server instance, keyed by visitor: allow("open", ip, 8, HOUR). */
const buckets = new Map<string, Map<string, number[]>>();

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export function allow(what: string, key: string, limit: number, windowMs: number): boolean {
  const b = buckets.get(what) ?? new Map<string, number[]>();
  buckets.set(what, b);
  const now = Date.now();
  const recent = (b.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    b.set(key, recent);
    return false;
  }
  recent.push(now);
  b.set(key, recent);
  if (b.size > 5000) for (const [k, v] of b) if (!v.some((t) => now - t < windowMs)) b.delete(k);
  return true;
}
