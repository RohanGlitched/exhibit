import { NextResponse } from "next/server";
import { analytics } from "@/lib/analytics";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** The desk as flat rows for the analytics dashboard: one per case, one per checked sentence. */
export async function GET() {
  return NextResponse.json(await analytics(), { headers: { "cache-control": "no-store" } });
}
