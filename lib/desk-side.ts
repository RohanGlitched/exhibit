import type { Filing } from "./cases/types";

/** The side of the latest ruling Exhibit asked for, read from its filing line ("Asked the sandbox to rule for the buyer"). */
export function askedSide(filings: Pick<Filing, "action" | "ok" | "detail">[]): "seller" | "buyer" | null {
  const f = filings.filter((x) => x.action === "ruling" && x.ok !== false).at(-1);
  const m = f?.detail?.match(/rule for the (seller|buyer)/);
  return m ? (m[1] as "seller" | "buyer") : null;
}
