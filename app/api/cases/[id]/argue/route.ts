import { argue } from "@/lib/cases/service";
import { CASE_ID } from "@/lib/store";
import { clientIp } from "@/lib/visitor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Streams the argument as newline-delimited JSON events. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!CASE_ID.test(id)) return Response.json({ error: "That isn't a PayPal case id." }, { status: 400 });
  const paced = new URL(req.url).searchParams.get("paced") !== "0";
  const ip = await clientIp();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of argue(id, { ip, paced })) controller.enqueue(enc.encode(JSON.stringify(ev) + "\n"));
      } catch (e) {
        controller.enqueue(enc.encode(JSON.stringify({ type: "error", text: (e as Error).message }) + "\n"));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
