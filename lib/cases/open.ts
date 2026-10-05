import "server-only";
import { addTracking, cardCheckout, refundCapture } from "../paypal/orders";
import { getDispute, simulateChargeback } from "../paypal/disputes";
import { SCENARIOS, scenario as findScenario, type Scenario } from "../shop/scenarios";
import { listCases, saveCase, updateCase } from "../store";
import type { CaseRecord } from "./types";

/**
 * Opening a case is three real sandbox calls: the buyer pays the shop by card (Orders v2), the shop adds the
 * tracking number (Orders v2 tracking), and the card issuer files a chargeback (the sandbox chargeback
 * simulator). PayPal then reviews the chargeback for about five to eight minutes before it reaches the seller,
 * so Exhibit keeps a small pool of cases already opened, and hands a visitor one that is ready.
 */

export const POOL_PER_SCENARIO = Number(process.env.POOL_PER_SCENARIO || 2);
const READY_STATES = new Set(["WAITING_FOR_SELLER_RESPONSE"]);

function invoiceNumber(): string {
  const n = 1040 + Math.floor((Date.now() / 1000) % 100000);
  return `HC-${n}`;
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
  return rec;
}

/** Opens cases until every scenario has POOL_PER_SCENARIO unclaimed ones (ready or still with PayPal). */
export async function refillPool(limit = 6): Promise<{ opened: string[]; errors: string[] }> {
  const cases = await listCases();
  const opened: string[] = [];
  const errors: string[] = [];
  for (const s of SCENARIOS) {
    const waiting = cases.filter((c) => c.scenarioId === s.id && !c.claimedBy && !c.brief).length;
    for (let i = waiting; i < POOL_PER_SCENARIO && opened.length < limit; i++) {
      try {
        opened.push((await openCase(s)).disputeId);
      } catch (e) {
        errors.push(`${s.id}: ${(e as Error).message}`);
        break;
      }
    }
  }
  return { opened, errors };
}

/**
 * Hands the visitor an unclaimed case for a scenario that PayPal has already passed to the seller. Returns
 * null when none is ready yet (the caller then opens a fresh one and shows it arriving).
 */
export async function claimReady(scenarioId: string, visitor: string): Promise<CaseRecord | null> {
  if (!findScenario(scenarioId)) return null;
  const candidates = (await listCases())
    .filter((c) => c.scenarioId === scenarioId && !c.claimedBy && !c.brief)
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  for (const c of candidates) {
    const d = await getDispute(c.disputeId).catch(() => null);
    if (!d || !READY_STATES.has(d.status)) continue;
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
