import { NextResponse } from "next/server";
import { refillPool } from "@/lib/cases/open";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Keeps a few cases opened ahead of time, so a visitor's case is already with the seller. Called with
 * `Authorization: Bearer CRON_SECRET` by the GitHub schedule every two hours (POST) and by Vercel Cron once a
 * day (GET, which sends the same header).
 */
async function refill(req: Request, by: string) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  return NextResponse.json(await refillPool(6, by));
}

export const POST = (req: Request) => refill(req, req.headers.get("x-refill-by") === "github" ? "github" : "cron");
export const GET = (req: Request) => refill(req, "vercel-cron");
