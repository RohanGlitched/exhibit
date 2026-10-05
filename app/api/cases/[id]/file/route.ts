import { NextResponse } from "next/server";
import { fileAction, type FileAction } from "@/lib/cases/service";
import { CASE_ID } from "@/lib/store";
import { clientIp } from "@/lib/visitor";
import { MINUTE, allow } from "@/lib/limits";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ACTIONS: FileAction[] = ["evidence", "accept", "offer", "message", "ruling"];

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: FileAction };
  if (!CASE_ID.test(id) || !body.action || !ACTIONS.includes(body.action)) {
    return NextResponse.json({ error: "Choose what to file." }, { status: 400 });
  }
  if (!allow("file", await clientIp(), 30, 10 * MINUTE)) {
    return NextResponse.json({ error: "That's a lot of filings in ten minutes from one place. Give it a few minutes." }, { status: 429 });
  }
  try {
    return NextResponse.json({ filing: await fileAction(id, body.action) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
