/** When a case may be argued again. Pure, so the tests can reach it. */
import type { Filing } from "./types";

/** Filed means PayPal holds the seller's answer: a response with evidence, or an accepted claim. */
export const isFiled = (filings: Filing[]) => filings.some((f) => f.action === "evidence" || f.action === "accept");

/**
 * Why a case's brief must stay as it is, or null when it may be (re)argued. Once a response is filed or PayPal
 * has resolved the case, the brief is the record of what was sent, so nothing replaces it: not the page, not
 * MCP's argue_case, not the webhook autopilot.
 */
export function argueBlocked(status: string | undefined, filings: Filing[]): string | null {
  if (isFiled(filings)) return "This case is already filed with PayPal, so its brief stays as filed.";
  if (status === "RESOLVED") return "PayPal has resolved this case, so there is nothing left to argue.";
  return null;
}
