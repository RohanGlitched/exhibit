import "server-only";
import { addTracking, cardCheckout, refundCapture, type Order } from "../paypal/orders";
import { getDispute, simulateChargeback, type Dispute } from "../paypal/disputes";
import type { PayPalError } from "../paypal/client";
import { buyForStory } from "../agentic/buyer";
import { signer } from "../agentic/keys";
import type { AgentRun } from "../agentic/types";
import { product } from "../shop/catalog";
import { hasStorage } from "../storage";
import { takeDaily } from "../budget";
import { HOUR, allow } from "../limits";
import { SCENARIOS, newCaseCast, scenario as findScenario, type Scenario } from "../shop/scenarios";
import { listCases, saveCase, updateCase } from "../store";
import { storage } from "../storage";
import { inPool, refillPlan } from "./pool";
import type { CaseRecord } from "./types";

/**
 * Opening a case is three real sandbox calls: the buyer pays the shop by card (Orders v2), the shop adds the
 * tracking number (Orders v2 tracking), and the card issuer files a chargeback (the sandbox chargeback
 * simulator). PayPal then reviews the chargeback for about five to eight minutes before it reaches the seller,
 * so Exhibit keeps a small pool of cases already opened, and hands a visitor one that is ready.
 *
 * A seller has ten days to respond, so pooled cases go stale: the refill retires any case PayPal has closed or
 * whose deadline is about to pass, and opens a fresh one in its place.
 */

export const POOL_PER_SCENARIO = Number(process.env.POOL_PER_SCENARIO || 2);
const READY = "WAITING_FOR_SELLER_RESPONSE";
const MIN_DAYS_LEFT = 1.5; // never hand out a case the visitor can't finish before PayPal's deadline

const daysLeft = (d: Dispute) => (d.seller_response_due_date ? (new Date(d.seller_response_due_date).getTime() - Date.now()) / 86_400_000 : Infinity);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function invoiceNumber(): string {
  // Reads like a store's running order numbers; the last digit is random so two cases opened in the same second differ.
  const n = Math.floor(Date.now() / 1000) % 100000;
  return `HC-${String(n).padStart(5, "0")}${Math.floor(Math.random() * 10)}`;
}

/** PayPal lists a new chargeback a moment after the simulator returns; wait until it can be read. */
async function waitForDispute(id: string): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const d = await getDispute(id).catch((e: PayPalError) => (e.status === 404 ? null : undefined));
    if (d !== null) return;
    await pause(1500);
  }
}

/**
 * An agent story's purchase: the buyer's agent shops under the cardholder's signed intent, signs its cart and
 * pays through Orders v2 with "ap2:" + the cart's SHA-256 in custom_id. The model runs within a per-visitor cap
 * (3 an hour; the pool refill 12 an hour) and takes each step from the daily model budget; past either, the
 * scripted agent makes the same purchase through the same tools and the case says so.
 */
async function agentPurchase(s: Scenario, invoiceId: string, openedAt: Date, visitor?: string): Promise<{ order: Order; agent: AgentRun; invoiceId: string }> {
  // Mandates signed with throwaway keys would never verify again: refuse them on the shared store.
  if (hasStorage() && (["wallet", "agent"] as const).some((r) => signer(r)?.origin !== "env")) {
    throw new Error("Agent stories need EXHIBIT_WALLET_SIGNING_KEY and EXHIBIT_AGENT_SIGNING_KEY set (see .env.example).");
  }
  const orderAt = new Date(openedAt.getTime() - s.orderDaysAgo * 86_400_000);
  const allowModel = allow("buyer-agent", visitor ? `v:${visitor}` : "pool", visitor ? 3 : 12, HOUR);
  const placed: { order: Order | null } = { order: null };
  let invoice = invoiceId;
  const run = await buyForStory(s, {
    invoiceId,
    orderAt,
    allowModel,
    noModelReason: visitor ? "this visitor has used the hour's three live buyer-agent runs" : "the pool's live buyer-agent runs for this hour are used up",
    budget: () => takeDaily(),
    pay: async (cart, customId) => {
      // A second payment (the scripted agent after the model bought the wrong cart) needs its own invoice number.
      if (placed.order) invoice = invoiceNumber();
      placed.order = await cardCheckout({
        buyer: { name: s.buyer.name, email: s.buyer.email, card: s.buyer.card, address: s.buyer.shipTo },
        items: cart.mandate.items.map((i) => ({ name: i.name, sku: i.sku, price: i.price, quantity: i.quantity, description: product(i.sku).listing })),
        shippingCost: cart.mandate.shipping,
        invoiceId: invoice,
        description: `Halden Ceramics order ${invoice}, placed by the buyer's shopping agent`,
        customId,
      });
      return { orderId: placed.order.id, status: placed.order.status };
    },
  });
  const { session: _session, ...agent } = run;
  void _session;
  return { order: placed.order!, agent, invoiceId: invoice };
}

export async function openCase(story: Scenario, opts: { visitor?: string } = {}): Promise<CaseRecord> {
  let invoiceId = invoiceNumber();
  // The story's clock starts here: the store's order time, and so the mandates' times, count back from it.
  const openedAt = new Date();
  // One of the story's customers, and a tracking number of the carrier's shape, so no two cases look cloned.
  const cast = newCaseCast(story);
  const s = findScenario(story.id, cast) ?? story;
  let order: Order;
  let agent: AgentRun | undefined;
  if (s.agent) {
    ({ order, agent, invoiceId } = await agentPurchase(s, invoiceId, openedAt, opts.visitor));
  } else {
    order = await cardCheckout({
      buyer: { name: s.buyer.name, email: s.buyer.email, card: s.buyer.card, address: s.buyer.shipTo },
      items: s.items,
      shippingCost: s.shipping,
      invoiceId,
      description: `Halden Ceramics order ${invoiceId}`,
    });
  }
  const capture = order.purchase_units[0]?.payments?.captures?.[0];
  if (!capture || capture.status !== "COMPLETED") throw new Error("The sandbox payment didn't complete.");

  if (s.carrier) await addTracking(order.id, capture.id, s.carrier.code, s.carrier.number, s.items);

  // "Charged twice": the double click is real too. A second identical charge, refunded in full the next "day".
  let refundId: string | undefined;
  if (s.reason === "DUPLICATE_TRANSACTION") {
    const dup = await cardCheckout({
      buyer: { name: s.buyer.name, email: s.buyer.email, card: s.buyer.card, address: s.buyer.shipTo },
      items: s.items,
      shippingCost: s.shipping,
      invoiceId: `${invoiceId}-B`,
      description: `Halden Ceramics order ${invoiceId} (duplicate)`,
    });
    const dupCapture = dup.purchase_units[0]?.payments?.captures?.[0];
    if (dupCapture) refundId = (await refundCapture(dupCapture.id, "Refund of a duplicate charge for the same order.")).id;
  }

  const disputeId = await simulateChargeback({
    captureId: capture.id,
    amount: capture.amount,
    reasonCode: s.reasonCode,
    cardBrand: s.cardBrand,
    merchantId: "",
  });
  const rec: CaseRecord = {
    disputeId,
    scenarioId: s.id,
    buyer: s.buyerIndex,
    tracking: s.carrier?.number,
    orderId: order.id,
    captureId: capture.id,
    invoiceId,
    openedAt: openedAt.toISOString(),
    ...(agent ? { agent } : {}),
    refundId,
    filings: [],
  };
  await saveCase(rec);
  await waitForDispute(disputeId);
  return rec;
}

/** Why a pooled case can no longer be handed to a visitor, or null while it's fine. */
async function poolProblem(c: CaseRecord): Promise<string | null> {
  const ageHours = (Date.now() - new Date(c.openedAt).getTime()) / 3_600_000;
  let d: Dispute;
  try {
    d = await getDispute(c.disputeId);
  } catch (e) {
    if ((e as PayPalError).status === 404) return ageHours > 1 ? "PayPal never registered the chargeback" : null;
    return null; // a PayPal hiccup: judge it on the next refill
  }
  if (d.status === READY) return daysLeft(d) < MIN_DAYS_LEFT ? "the response deadline is about to pass" : null;
  // A new chargeback sits with PayPal (OPEN, or UNDER_REVIEW with nothing filed) for a few minutes first.
  const withPayPal = d.status === "OPEN" || (d.status === "UNDER_REVIEW" && !(d.evidences ?? []).some((e) => e.source === "SUBMITTED_BY_SELLER"));
  if (withPayPal) return ageHours > 3 ? "PayPal never handed the case to the seller" : null;
  return `PayPal shows it as ${d.status.toLowerCase().replace(/_/g, " ")}`;
}

/** When the refill last ran and what it did, for /api/health. Kept in the store (in memory without one). */
export interface RefillRun {
  startedAt: string;
  finishedAt?: string;
  by: string;
  opened?: number;
  retired?: number;
  errors?: number;
}
const REFILL_KEY = "pool/last-refill.json";
let lastRun: RefillRun | null = null;

async function noteRefill(run: RefillRun): Promise<void> {
  lastRun = run;
  await storage()?.write(REFILL_KEY, JSON.stringify(run)).catch((e) => console.error("refill note", (e as Error).message));
}

export async function lastRefill(): Promise<RefillRun | null> {
  const s = storage();
  if (!s) return lastRun;
  const r = await s.read(REFILL_KEY).catch(() => null);
  return r ? (JSON.parse(r.text) as RefillRun) : lastRun;
}

/**
 * Retires pooled cases that have gone stale, then opens cases until every scenario has POOL_PER_SCENARIO
 * unclaimed ones (ready, or still with PayPal), emptiest stories first. Called by the cron (the GitHub
 * schedule every two hours and Vercel's daily one) and after every case a visitor takes.
 */
export async function refillPool(limit = 6, by = "cron"): Promise<{ opened: string[]; retired: string[]; errors: string[] }> {
  const run: RefillRun = { startedAt: new Date().toISOString(), by };
  await noteRefill(run);
  const cases = await listCases(true);
  const opened: string[] = [];
  const retired: string[] = [];
  const errors: string[] = [];
  const stock = new Map<string, number>();
  for (const c of cases.filter(inPool)) {
    const why = await poolProblem(c);
    if (why) {
      await updateCase(c.disputeId, (r) => ({ ...r, retired: why })).catch((e) => errors.push(`${c.disputeId}: ${(e as Error).message}`));
      retired.push(`${c.disputeId}: ${why}`);
      continue;
    }
    stock.set(c.scenarioId ?? "", (stock.get(c.scenarioId ?? "") ?? 0) + 1);
  }
  // Empty stories first: a visit-time refill opens only three, and a story with no stock makes a visitor wait.
  const failed = new Set<string>();
  for (const id of refillPlan(Object.fromEntries(stock), SCENARIOS.map((s) => s.id), POOL_PER_SCENARIO, limit)) {
    const s = SCENARIOS.find((x) => x.id === id);
    if (!s || failed.has(id)) continue;
    try {
      opened.push((await openCase(s)).disputeId);
    } catch (e) {
      errors.push(`${s.id}: ${(e as Error).message}`);
      failed.add(id);
    }
  }
  await noteRefill({ ...run, finishedAt: new Date().toISOString(), opened: opened.length, retired: retired.length, errors: errors.length });
  return { opened, retired, errors };
}

/**
 * Hands the visitor an unclaimed case for a scenario that PayPal has already passed to the seller. Returns
 * null when none is ready yet (the caller then opens a fresh one and shows it arriving).
 */
export async function claimReady(scenarioId: string, visitor: string): Promise<CaseRecord | null> {
  if (!findScenario(scenarioId)) return null;
  const candidates = (await listCases(true)).filter((c) => inPool(c) && c.scenarioId === scenarioId).sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  for (const c of candidates) {
    const d = await getDispute(c.disputeId).catch(() => null);
    if (!d || d.status !== READY || daysLeft(d) < MIN_DAYS_LEFT) continue;
    const won = await updateCase(c.disputeId, (rec) =>
      rec.claimedBy ? null : { ...rec, claimedBy: visitor, claimedAt: new Date().toISOString() },
    );
    if (won) return won;
  }
  return null;
}

export async function claimFresh(s: Scenario, visitor: string): Promise<CaseRecord> {
  const rec = await openCase(s, { visitor });
  return (await updateCase(rec.disputeId, (r) => ({ ...r, claimedBy: visitor, claimedAt: new Date().toISOString() }))) ?? rec;
}
