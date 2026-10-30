import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { DESK_TAG } from "@/lib/desk";
import { fileAction, type FileAction } from "@/lib/cases/service";
import { CASE_ID } from "@/lib/store";
import { clientIp } from "@/lib/visitor";
import { MINUTE, allow } from "@/lib/limits";
import { loadCase } from "@/lib/store";
import { publicWriteBlocked, shopRequest } from "@/lib/cases/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ACTIONS: FileAction[] = ["evidence", "accept", "offer", "message", "ruling"];

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: FileAction };
  if (!CASE_ID.test(id) || !body.action || !ACTIONS.includes(body.action)) {
    return NextResponse.json({ error: "Choose what to file." }, { status: 400 });
  }
  const ip = await clientIp();
  if (!allow("file", ip, 30, 10 * MINUTE)) {
    return NextResponse.json({ error: "That's a lot of filings in ten minutes from one place. Give it a few minutes." }, { status: 429 });
  }
  const locked = shopRequest(req) ? null : publicWriteBlocked(id, await loadCase(id).catch(() => null), "file");
  if (locked) return NextResponse.json({ error: locked }, { status: 403 });
  try {
    const filing = await fileAction(id, body.action, "seller", { ip });
    // The desk and the home page's figures read one snapshot: a filing makes it stale at once.
    revalidateTag(DESK_TAG);
    return NextResponse.json({ filing });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
