import { clientIp } from "@/lib/visitor";
import { MINUTE, allow } from "@/lib/limits";
import { MAX_BODY, validate } from "@/lib/import/input";
import { buildCase } from "@/lib/import/build";
import { argueImport } from "@/lib/import/argue";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Bring your own case: takes a pasted order, tracking, dispute and email thread, and streams back the lettered
 * exhibits, the requirements card and a checked brief as newline-delimited JSON. It never files anything and
 * never calls PayPal; nothing is stored.
 */
export async function POST(req: Request) {
  const ip = await clientIp();
  if (!allow("import", ip, 12, 10 * MINUTE)) {
    return Response.json({ error: "That's twelve cases in ten minutes from one place. Give it a few minutes." }, { status: 429 });
  }
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) {
    return Response.json({ error: "Send the case as JSON." }, { status: 415 });
  }
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY) return Response.json({ error: "That's more than Exhibit reads at once. Trim the scans or the email thread." }, { status: 413 });
  const text = await req.text();
  if (text.length > MAX_BODY) return Response.json({ error: "That's more than Exhibit reads at once. Trim the scans or the email thread." }, { status: 413 });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return Response.json({ error: "The case didn't arrive as readable JSON." }, { status: 400 });
  }
  const checked = validate(raw);
  if (!checked.ok) {
    return Response.json({ error: "A few things need fixing before Exhibit can build the case.", problems: checked.problems }, { status: 422 });
  }
  const c = buildCase(checked.input);

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: object) => controller.enqueue(enc.encode(JSON.stringify(ev) + "\n"));
      try {
        send({ type: "case", head: c.head, exhibits: c.exhibits, card: c.card, notes: c.notes });
        const { brief, fallback } = await argueImport(c, ip, send);
        send({ type: "brief", brief, ...(fallback ? { fallback } : {}) });
      } catch (e) {
        console.error("import failed", (e as Error).message);
        send({ type: "error", text: "Exhibit couldn't finish the brief. Try again in a minute." });
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
