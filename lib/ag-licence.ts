/**
 * Which AG Grid Enterprise licence key the desk may use, read without loading AG Grid Enterprise. Pure and
 * client-safe, so it runs in the browser before the enterprise chunk is fetched and in the unit tests.
 *
 * The desk reads NEXT_PUBLIC_AG_GRID_LICENSE_KEY first. It also accepts NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY, but
 * only when that key is one AG Grid itself accepts: AG Grid 36.2's licence check (ag-grid-enterprise
 * src/license/shared/licenseManager.ts) takes a v3 key typed [01] (Grid) or [0102] (Grid and Charts), or an
 * older untyped key, and turns a v3 AG Studio key ([03A], [03B], [03C]) away as "Incompatible License Key",
 * with a watermark. AG Studio's own check (ag-studio src/studio/license) does the reverse: it takes only the
 * [03x] keys. So one Studio trial key does not unlock the grid; the grid needs its own Grid (or Grid and
 * Charts) key, and with none the desk stays on AG Grid Community exactly as before.
 *
 * This only reads the key's shape and its trial expiry. The checksum (and the release-date check for a paid
 * key) is AG's own: components/desk/EnterpriseGrid.tsx asks LicenseManager.getLicenseDetails before the
 * enterprise grid is used, and falls back to Community if AG says no.
 */

/** The licence types AG writes in a key's brackets. */
const TYPES: Record<string, string> = {
  "01": "GRID",
  "02": "CHARTS",
  "0102": "BOTH",
  "03A": "STUDIO-CORE",
  "03B": "STUDIO-PRO",
  "03C": "STUDIO-PRO-AI",
};

export interface LicenceShape {
  /** "legacy" (no brackets), "2", "3", ... */
  version: string;
  trial: boolean;
  /** GRID, CHARTS, BOTH or a STUDIO-* type; undefined for a key with no type in its brackets. */
  type: string | undefined;
  /** When the key stops working, read from the key itself; null if it can't be read. */
  expires: Date | null;
}

/** The same split AG makes: the last 32 characters are a checksum, the bracketed parts say what the key is. */
export function readLicence(raw: string): LicenceShape | null {
  const key = raw
    .replace(/[​-‍﻿]/g, "")
    .replace(/\r?\n|\r/g, "")
    .trim();
  if (key.length <= 32) return null;
  const body = key.slice(0, key.length - 32);
  const parts = (key.match(/\[(.*?)\]/g) ?? []).map((m) => m.slice(1, -1));
  const v = parts.find((p) => p.startsWith("v"));
  const typeCode = parts.find((p) => TYPES[p]);
  return {
    version: parts.length ? (v ? v.slice(1) : "legacy") : "legacy",
    trial: parts.filter((p) => p === "TRIAL").length === 1,
    type: typeCode ? TYPES[typeCode] : undefined,
    expires: expiryOf(body),
  };
}

function expiryOf(body: string): Date | null {
  const tail = body.slice(body.lastIndexOf("_") + 1).replace(/[^A-Za-z0-9+/=]/g, "");
  try {
    const ms = Number.parseInt(atob(tail), 10);
    return Number.isFinite(ms) ? new Date(ms) : null;
  } catch {
    return null;
  }
}

/**
 * Why AG Grid would refuse this key, or null if it looks like one AG Grid takes (the checksum is checked later,
 * by AG). A trial past its date is refused too: the desk goes back to Community rather than show AG's
 * "Trial Period Expired" watermark.
 */
export function gridLicenceProblem(raw: string | undefined, now = Date.now()): string | null {
  if (!raw?.trim()) return "no key";
  if (raw.includes("For_Trialing_ag-Grid_Only")) return "a documentation-only key";
  const k = readLicence(raw);
  if (!k) return "not a licence key";
  if (k.version === "3" && k.type !== "GRID" && k.type !== "BOTH")
    return k.type ? `a ${k.type} key, which AG Grid does not accept` : "a v3 key with no type";
  if (!k.expires) return "no expiry in the key";
  if (k.trial && k.expires.getTime() < now) return `a trial that ended ${k.expires.toISOString().slice(0, 10)}`;
  return null;
}

export interface GridLicence {
  key: string;
  /** Which variable it came from. */
  from: "NEXT_PUBLIC_AG_GRID_LICENSE_KEY" | "NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY";
  trial: boolean;
  /** YYYY-MM-DD. */
  expires: string | null;
}

/** The key the desk's grid should use, or null for AG Grid Community (no key, or none AG Grid would take). */
export function pickGridLicence(env: { grid?: string; studio?: string }, now = Date.now()): GridLicence | null {
  const tries = [
    ["NEXT_PUBLIC_AG_GRID_LICENSE_KEY", env.grid],
    ["NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY", env.studio],
  ] as const;
  for (const [from, raw] of tries) {
    if (!raw || gridLicenceProblem(raw, now)) continue;
    const k = readLicence(raw)!;
    return { key: raw.trim(), from, trial: k.trial, expires: k.expires ? k.expires.toISOString().slice(0, 10) : null };
  }
  return null;
}
