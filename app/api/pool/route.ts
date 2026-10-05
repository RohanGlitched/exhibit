import { NextResponse } from "next/server";
import { refillPool } from "@/lib/cases/open";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Keeps a few cases opened ahead of time, so a visitor's case is already with the seller. Called by cron. */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  return NextResponse.json(await refillPool(6));
}
