import { NextResponse, after } from "next/server";
import { refillPool } from "@/lib/cases/open";
import { autopilotTick } from "@/lib/cases/autopilot-run";

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
  return NextResponse.json(pool ?? { autopilot: "started" });
}

export const POST = (req: Request) => refill(req, req.headers.get("x-refill-by") === "github" ? "github" : "cron");
export const GET = (req: Request) => refill(req, "vercel-cron");
