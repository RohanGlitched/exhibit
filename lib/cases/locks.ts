/**
 * Which cases a public visitor or an anonymous MCP client may change. The cases the pitch, the video and the testing
 * notes point judges to are kept as they stand through judging (Dec 15): nobody outside the shop can accept a claim,
 * file, ask for a ruling, re-argue or hold a saved hearing on them. The seller's lane is the autopilot's: it works
 * those cases under the house rules, so public writes are refused there too. Taking the reviewer's chair (an
 * objection that is answered and never saved) and every read stay open. Pure and client-safe.
 */
import { SHOWCASE_ID } from "../showcase-rank";

/** The cases named in the pitch, the gallery, the video and the testing instructions. */
export const PITCH_CASES = [
  "PP-R-HWG-10195220",
  "PP-R-IPX-10195230",
  "PP-R-BFL-10195216",
  "PP-R-OHE-10195198",
  "PP-R-GQZ-10195194",
  "PP-R-SMJ-10195232",
  "PP-R-EHD-10194372",
  "PP-R-DNN-10195228",
  "PP-R-UPI-10195190",
  "PP-R-JWB-10194389",
  "PP-R-UVT-10195188",
] as const;

/** PITCH_CASES, the pinned flagship, and any ids in EXHIBIT_LOCKED_CASES (comma-separated). */
export function lockedCases(env: string | undefined = process.env.EXHIBIT_LOCKED_CASES, pin: string | undefined = process.env.SHOWCASE_ID): Set<string> {
  const extra = (env ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return new Set<string>([...PITCH_CASES, SHOWCASE_ID, ...(pin?.trim() ? [pin.trim()] : []), ...extra]);
}

export type PublicWrite = "file" | "argue" | "hearing";

/** The shop's own maintenance calls (the cron secret) aren't public writes. */
export function shopRequest(req: Request, secret: string | undefined = process.env.CRON_SECRET): boolean {
  return Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
}

/** Why a public write on this case is refused, or null when it is allowed. */
export function publicWriteBlocked(id: string, rec: { lane?: string } | null | undefined, what: PublicWrite, locked: Set<string> = lockedCases()): string | null {
  const verb = what === "file" ? "filed on" : what === "argue" ? "re-argued" : "re-heard";
  if (locked.has(id)) {
    return `${id} is one of the cases the pitch and the video point to, so it stays as it stands and can't be ${verb} from the public site or MCP. Open your own case at /new to try every action; you can still object from the reviewer's chair here, and nothing is saved.`;
  }
  if (rec?.lane === "autopilot") {
    return `${id} is on the seller's lane: the autopilot works it under the house rules, so it can't be ${verb} from the public site or MCP. Open your own case at /new to try every action.`;
  }
  return null;
}
