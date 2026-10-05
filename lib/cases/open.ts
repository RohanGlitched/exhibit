import "server-only";
import { addTracking, cardCheckout, refundCapture } from "../paypal/orders";
import { getDispute, simulateChargeback, type Dispute } from "../paypal/disputes";
import type { PayPalError } from "../paypal/client";
import { SCENARIOS, scenario as findScenario, type Scenario } from "../shop/scenarios";
import { listCases, saveCase, updateCase } from "../store";
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

const inPool = (c: CaseRecord) => !c.claimedBy && !c.brief && !c.retired;
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

export async function openCase(s: Scenario): Promise<CaseRecord> {
  const invoiceId = invoiceNumber();
  const order = await cardCheckout({
    buyer: { name: s.buyer.name, email: s.buyer.email, card: s.buyer.card, address: s.buyer.shipTo },
    items: s.items,
    shippingCost: s.shipping,
    invoiceId,
    description: `Halden Ceramics order ${invoiceId}`,
  });
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
    orderId: order.id,
    captureId: capture.id,
    invoiceId,
    openedAt: new Date().toISOString(),
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
  if (d.status === "OPEN") return ageHours > 3 ? "PayPal never handed the case to the seller" : null;
  return `PayPal shows it as ${d.status.toLowerCase().replace(/_/g, " ")}`;
}

/**
 * Retires pooled cases that have gone stale, then opens cases until every scenario has POOL_PER_SCENARIO
 * unclaimed ones (ready, or still with PayPal). Called by the cron and after every case a visitor takes.
 */
export async function refillPool(limit = 6): Promise<{ opened: string[]; retired: string[]; errors: string[] }> {
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
  for (const s of SCENARIOS) {
    for (let i = stock.get(s.id) ?? 0; i < POOL_PER_SCENARIO && opened.length < limit; i++) {
      try {
        opened.push((await openCase(s)).disputeId);
      } catch (e) {
        errors.push(`${s.id}: ${(e as Error).message}`);
        break;
      }
    }
  }
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
  const rec = await openCase(s);
  return (await updateCase(rec.disputeId, (r) => ({ ...r, claimedBy: visitor, claimedAt: new Date().toISOString() }))) ?? rec;
}
