import "server-only";
import { PAYPAL_BASE, accessToken } from "../paypal/client";
import { getDispute } from "../paypal/disputes";
import { CASE_ID, loadCase, updateCase } from "../store";
import { takeAutopilotCall } from "../budget";
import { argue } from "../cases/service";
import { isFiled } from "../cases/guard";
import { inPool } from "../cases/pool";
import type { Brief, CaseRecord } from "../cases/types";
import { disputeIdOf, isDisputeEvent, outcomeWords, routeFor, statusWords, verificationBody, type WebhookEvent } from "./paypal";

export type Verdict = "verified" | "unconfigured" | "invalid";

/** Asks PayPal whether a delivery really came from it, for the webhook Exhibit registered (PAYPAL_WEBHOOK_ID). */
export async function verifyDelivery(headers: Headers, raw: string): Promise<Verdict> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return "unconfigured";
  const body = verificationBody(headers, webhookId, raw);
  if (!body) return "invalid";
  const res = await fetch(`${PAYPAL_BASE}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json", accept: "application/json" },
    body,
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`PayPal's signature check answered HTTP ${res.status}`);
  const j = (await res.json().catch(() => ({}))) as { verification_status?: string };
  return j.verification_status === "SUCCESS" ? "verified" : "invalid";
}

export interface Handled {
  disputeId: string | null;
  did: string;
  ok: boolean;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** PayPal can announce a case a moment before openCase has saved its record: give it a few seconds. */
async function recordFor(id: string, waitMs: number): Promise<CaseRecord | null> {
  const until = Date.now() + waitMs;
  for (;;) {
    const rec = await loadCase(id).catch(() => null);
    if (rec || Date.now() >= until) return rec;
    await pause(1500);
  }
}

/**
 * Argues a case the moment PayPal sends it, so a visitor finds the brief already written. Uses the model while
 * the autopilot's half of today's budget lasts, the rules engine after. Never replaces an existing brief.
 */
async function autoArgue(id: string, ev: WebhookEvent, receivedAt: string): Promise<Handled> {
  if (process.env.AUTOPILOT === "off") return { disputeId: id, did: "Not argued: the autopilot is off", ok: true };
  const rec = await recordFor(id, 10_000);
  if (rec?.brief) return { disputeId: id, did: "Already argued; left as it was", ok: true };
  if (rec && isFiled(rec.filings)) return { disputeId: id, did: "Already filed; left as it was", ok: true };
  const useModel = await takeAutopilotCall().catch(() => false);
  let brief: Brief | null = null;
  let error: string | null = null;
  for await (const e of argue(id, { ip: "paypal-webhook", paced: false, useModel, autopilot: { eventId: ev.id, receivedAt } })) {
    if (e.type === "brief") brief = e.brief;
    else if (e.type === "error") error = e.text;
  }
  if (!brief) return { disputeId: id, did: `Couldn't argue: ${error ?? "no brief came back"}`, ok: false };
  const saved = await loadCase(id).catch(() => null);
  if (saved?.autopilot?.briefAt !== brief.createdAt) return { disputeId: id, did: "Argued, but a visitor's brief was saved first and kept", ok: true };
  const call = brief.recommendation === "accept" ? "refund" : brief.recommendation === "offer" ? "offer" : "fight";
  return { disputeId: id, did: `Argued with the ${brief.engine === "model" ? "model" : "rules engine"}: ${call}, evidence balance ${brief.odds}% for the seller`, ok: true };
}

/** Reads the case back from PayPal after an update, stamps what it shows, and retires resolved pool stock. */
async function refresh(id: string, ev: WebhookEvent, receivedAt: string): Promise<Handled> {
  const d = await getDispute(id);
  const outcome = d.dispute_outcome?.outcome_code;
  const said = `PayPal shows it ${statusWords(d.status)}${outcome ? `, ${outcomeWords(outcome)}` : ""}`;
  const rec = await loadCase(id).catch(() => null);
  if (!rec) return { disputeId: id, did: `Noted: ${said}; Exhibit holds no record of this case`, ok: true };
  const stamp = { id: ev.id, type: ev.event_type, receivedAt, status: d.status, ...(outcome ? { outcome } : {}) };
  await updateCase(id, (r) => ({
    ...r,
    lastEvent: stamp,
    events: [...(r.events ?? []).filter((e) => e.id !== stamp.id), stamp].slice(-12),
    ...(d.status === "RESOLVED" && inPool(r) ? { retired: "PayPal resolved it" } : {}),
  }));
  // A case that reached the seller with no brief yet (its CREATED delivery was missed): argue it now.
  if (d.status === "WAITING_FOR_SELLER_RESPONSE" && !rec.brief && !rec.claimedBy && !rec.retired) {
    const argued = await autoArgue(id, ev, receivedAt);
    return { ...argued, did: `Refreshed (${said}). ${argued.did}` };
  }
  return { disputeId: id, did: `Refreshed: ${said}`, ok: true };
}

/** Does what a verified dispute event calls for. */
export async function handleEvent(ev: WebhookEvent, receivedAt: string): Promise<Handled> {
  const id = disputeIdOf(ev);
  if (!isDisputeEvent(ev.event_type)) return { disputeId: id, did: `Ignored: ${ev.event_type} isn't a dispute event`, ok: true };
  if (!id || !CASE_ID.test(id)) return { disputeId: id, did: "Ignored: the event names no dispute", ok: true };
  try {
    return routeFor(ev.event_type) === "argue" ? await autoArgue(id, ev, receivedAt) : await refresh(id, ev, receivedAt);
  } catch (e) {
    return { disputeId: id, did: `Failed: ${(e as Error).message}`, ok: false };
  }
}
