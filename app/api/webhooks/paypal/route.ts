import { NextResponse, after } from "next/server";
import { handleEvent, verifyDelivery } from "@/lib/webhooks/handle";
import { appendWebhookLog, handledEvent } from "@/lib/webhooks/log";
import type { WebhookEvent } from "@/lib/webhooks/paypal";
import { clientIp } from "@/lib/visitor";
import { storage } from "@/lib/storage";
import { MINUTE, allow } from "@/lib/limits";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * PayPal's webhook for CUSTOMER.DISPUTE.CREATED, .UPDATED and .RESOLVED. Each delivery is checked with
 * POST /v1/notifications/verify-webhook-signature before anything happens. PayPal gets its 200 at once; the
 * work (arguing a new case, or reading an updated one back) runs right after, and lands in the webhook log.
 */
export async function POST(req: Request) {
  const receivedAt = new Date().toISOString();
  const t0 = Date.now();
  if (!allow("webhook", await clientIp(), 120, MINUTE)) return NextResponse.json({ error: "Too many deliveries." }, { status: 429 });
  const raw = await req.text();
  if (raw.length > 256_000) return NextResponse.json({ error: "Too large." }, { status: 413 });
  let ev: WebhookEvent;
  try {
    ev = JSON.parse(raw) as WebhookEvent;
  } catch {
    return NextResponse.json({ error: "Not JSON." }, { status: 400 });
  }
  if (!ev?.id || !ev.event_type) return NextResponse.json({ error: "Not a PayPal event." }, { status: 400 });

  let verdict;
  try {
    verdict = await verifyDelivery(req.headers, raw);
  } catch (e) {
    // PayPal's own check didn't answer: a 5xx makes PayPal deliver again later.
    console.error("webhook verify", (e as Error).message);
    return NextResponse.json({ error: "Couldn't verify the delivery yet." }, { status: 503 });
  }
  if (verdict === "unconfigured") return NextResponse.json({ error: "Webhooks aren't set up on this server." }, { status: 503 });
  if (verdict === "invalid") return NextResponse.json({ error: "The signature didn't verify." }, { status: 401 });

  if (await handledEvent(ev.id)) return NextResponse.json({ ok: true, duplicate: true });

  after(async () => {
    await captureDelivery(ev.event_type, req.headers, raw).catch(() => {});
    const r = await handleEvent(ev, receivedAt);
    await appendWebhookLog({ id: ev.id, type: ev.event_type, receivedAt, disputeId: r.disputeId, did: r.did, ok: r.ok, ms: Date.now() - t0 });
  });
  return NextResponse.json({ ok: true });
}

/**
 * The first verified delivery of each event type, kept byte for byte with its transmission headers (signatures,
 * not secrets), so the test suite can replay a real signed RESOLVED delivery. Read with the cron secret.
 */
const CAPTURE = (type: string) => `webhooks/captured/${type.replace(/[^A-Z._]/g, "")}.json`;
const SIGNED = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"];

async function captureDelivery(type: string, headers: Headers, raw: string): Promise<void> {
  const s = storage();
  if (!s || (await s.read(CAPTURE(type)).catch(() => null))) return;
  await s.write(CAPTURE(type), JSON.stringify({ type, headers: Object.fromEntries(SIGNED.map((h) => [h, headers.get(h) ?? ""])), raw }));
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const type = new URL(req.url).searchParams.get("captured") ?? "CUSTOMER.DISPUTE.RESOLVED";
  const r = await storage()?.read(CAPTURE(type)).catch(() => null);
  return r ? new NextResponse(r.text, { headers: { "content-type": "application/json" } }) : NextResponse.json({ error: "Nothing captured yet." }, { status: 404 });
}
