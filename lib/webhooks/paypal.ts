/**
 * PayPal webhooks, the pure parts: building the verify-webhook-signature request, reading a dispute event,
 * and what the case page says about it. No server-only imports, so the tests and scripts can use it too.
 */
import type { CaseRecord } from "../cases/types";

export const DISPUTE_EVENTS = ["CUSTOMER.DISPUTE.CREATED", "CUSTOMER.DISPUTE.UPDATED", "CUSTOMER.DISPUTE.RESOLVED"] as const;
export type DisputeEventType = (typeof DISPUTE_EVENTS)[number];
export const isDisputeEvent = (t: string | undefined): t is DisputeEventType => DISPUTE_EVENTS.includes(t as DisputeEventType);

/** The part of a PayPal webhook event Exhibit reads. For dispute events `resource` is the dispute. */
export interface WebhookEvent {
  id: string;
  event_type: string;
  create_time?: string;
  resource_type?: string;
  summary?: string;
  resource?: {
    dispute_id?: string;
    id?: string;
    status?: string;
    dispute_outcome?: { outcome_code?: string };
  };
}

/** The five transmission headers PayPal signs a delivery with, by the field name verify-webhook-signature takes. */
export const SIGNATURE_HEADERS = {
  auth_algo: "paypal-auth-algo",
  cert_url: "paypal-cert-url",
  transmission_id: "paypal-transmission-id",
  transmission_sig: "paypal-transmission-sig",
  transmission_time: "paypal-transmission-time",
} as const;

type HeaderSource = Headers | Record<string, string | undefined>;

function header(h: HeaderSource, name: string): string | undefined {
  if (typeof (h as Headers).get === "function") return (h as Headers).get(name) ?? undefined;
  const rec = h as Record<string, string | undefined>;
  const key = Object.keys(rec).find((k) => k.toLowerCase() === name);
  return key ? rec[key] : undefined;
}

/**
 * The JSON body for POST /v1/notifications/verify-webhook-signature, or null when a signature header is
 * missing or the delivery isn't a JSON object. The event goes in exactly as PayPal sent it (spliced in as raw
 * text, not parsed and re-serialised), because PayPal checks the signature against those exact bytes.
 */
export function verificationBody(headers: HeaderSource, webhookId: string, rawBody: string): string | null {
  if (!webhookId) return null;
  const fields: Record<string, string> = {};
  for (const [field, name] of Object.entries(SIGNATURE_HEADERS)) {
    const v = header(headers, name)?.trim();
    if (!v) return null;
    fields[field] = v;
  }
  const raw = rawBody.trim();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  } catch {
    return null;
  }
  const head = JSON.stringify({ ...fields, webhook_id: webhookId });
  return `${head.slice(0, -1)},"webhook_event":${raw}}`;
}

/** The dispute id an event is about, if it names one. */
export function disputeIdOf(ev: WebhookEvent): string | null {
  const r = ev.resource;
  const id = r?.dispute_id ?? (r?.id?.startsWith("PP-") ? r.id : undefined);
  return id ?? null;
}

const OUTCOMES: Record<string, string> = {
  RESOLVED_BUYER_FAVOUR: "for the buyer",
  RESOLVED_SELLER_FAVOUR: "for the seller",
  RESOLVED_WITH_PAYOUT: "with a payout",
  CANCELED_BY_BUYER: "the buyer withdrew it",
  ACCEPTED: "the seller accepted the claim",
  DENIED: "denied",
};
export const outcomeWords = (code?: string | null) => (code ? (OUTCOMES[code] ?? code.toLowerCase().replace(/_/g, " ")) : null);
export const statusWords = (s?: string | null) => (s ? s.toLowerCase().replace(/_/g, " ") : "unknown");

/** What the case page shows about PayPal's webhook deliveries for one case. */
export interface WebhookView {
  /** When PayPal's CUSTOMER.DISPUTE.CREATED reached Exhibit, if Exhibit argued the case from it. */
  receivedAt: string | null;
  arguedAt: string | null;
  /** Seconds from the delivery to a saved brief. */
  seconds: number | null;
  engine: "model" | "rules" | "paypal" | null;
  /** Whether the brief on the case is still the one the autopilot wrote. */
  current: boolean;
  last: { type: string; receivedAt: string; status: string; outcome: string | null } | null;
}

export function webhookView(rec: CaseRecord | null | undefined): WebhookView | null {
  if (!rec?.autopilot && !rec?.lastEvent) return null;
  const a = rec.autopilot;
  const seconds = a ? Math.max(0, Math.round((new Date(a.arguedAt).getTime() - new Date(a.receivedAt).getTime()) / 1000)) : null;
  return {
    receivedAt: a?.receivedAt ?? null,
    arguedAt: a?.arguedAt ?? null,
    seconds,
    engine: a?.engine ?? null,
    current: Boolean(a && rec.brief && rec.brief.createdAt === a.briefAt),
    last: rec.lastEvent ? { type: rec.lastEvent.type, receivedAt: rec.lastEvent.receivedAt, status: rec.lastEvent.status, outcome: rec.lastEvent.outcome ?? null } : null,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "25 Oct, 14:02 UTC" */
export function utcStamp(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}
