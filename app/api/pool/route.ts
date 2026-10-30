import { NextResponse, after } from "next/server";
import { refillPool } from "@/lib/cases/open";
import { autopilotTick } from "@/lib/cases/autopilot-run";
import { SITE_URL } from "@/lib/site";
import { PITCH_CASES } from "@/lib/cases/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Keeps a few cases opened ahead of time, so a visitor's case is already with the seller, then runs one turn of
 * the autopilot (lib/cases/autopilot-run.ts) after the answer has gone. Called with
 * `Authorization: Bearer CRON_SECRET` by the hourly server cron and the GitHub schedule (POST) and by Vercel Cron
 * once a day (GET, which sends the same header). `?only=autopilot` skips the refill; `?open=<story>` also opens
 * a case of that story on the seller's lane.
 */
async function refill(req: Request, by: string) {
  const t0 = Date.now();
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const url = new URL(req.url);
  const open = url.searchParams.get("open");
  const pool = url.searchParams.get("only") === "autopilot" ? null : await refillPool(6, by);
  after(() => autopilotTick(t0 + 280_000, { open }).catch((e) => console.error("autopilot", e)));
  // Every scheduled call also warms the pages a judge opens first, so none of them is a cold start.
  after(() => warmPitchPages());
  return NextResponse.json(pool ?? { autopilot: "started" });
}

export const POST = (req: Request) => refill(req, req.headers.get("x-refill-by") === "github" ? "github" : "cron");
export const GET = (req: Request) => refill(req, "vercel-cron");

/** The home page, /judges, /proof and the case pages the pitch links to, fetched once each, in parallel, read-only. */
async function warmPitchPages() {
  const paths = ["/", "/judges", "/proof", "/desk", ...["PP-R-HWG-10195220", "PP-R-OHE-10195198", "PP-R-IPX-10195230", "PP-R-YAC-10195241", "PP-R-DNN-10195228", ...PITCH_CASES].filter((v, i, a) => a.indexOf(v) === i).map((id) => `/case/${id}`)];
  await Promise.allSettled(
    paths.map((p) => fetch(`${SITE_URL}${p}`, { headers: { "x-exhibit-warm": "1" }, cache: "no-store", signal: AbortSignal.timeout(120_000) }).then((r) => r.arrayBuffer())),
  );
}
