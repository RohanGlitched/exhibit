import "server-only";
import { allowed, getDispute } from "../paypal/disputes";
import { listCases, loadCase, updateCase } from "../store";
import { storage } from "../storage";
import { scenario as findScenario } from "../shop/scenarios";
import { takeAutopilotCall } from "../budget";
import { argue, fileAction } from "./service";
import { reviewCase } from "./cross";
import { openCase } from "./open";
import { isFiled } from "./guard";
import { HOUSE_RULES, laneStoryFor, planDue, planFor, rulingDue } from "./autopilot";
import type { Brief, CaseRecord } from "./types";

/**
 * One turn of the autopilot, run after every pool refill (the hourly cron, the GitHub schedule and Vercel's
 * daily cron all POST /api/pool). It works the seller's own lane under the house rules:
 * 1. a lane case PayPal has passed to the seller with a brief but no plan: hold a hearing on the draft, then
 *    decide under the rules (refund, file, or leave it for the seller) and start the undo window;
 * 2. a plan whose undo window has passed: send it through the Disputes API, as the autopilot;
 * 3. a filed fight PayPal has opened for a ruling: ask for the ruling the hearing on PayPal's copy reaches
 *    (lane cases at once; anyone else's after two hours, so a visitor can still ask first);
 * 4. once a day, open the next lane case, so the loop keeps running through judging.
 * Every step is bounded by the time left in the request.
 */

const IP = "autopilot";
const LANE_EVERY_HOURS = 22;
const LAST_KEY = "autopilot/last-tick.json";

export interface TickReport {
  startedAt: string;
  finishedAt?: string;
  steps: string[];
  errors: string[];
}

const left = (deadline: number) => deadline - Date.now();

async function argueLane(rec: CaseRecord): Promise<string> {
  const useModel = await takeAutopilotCall().catch(() => false);
  let brief: Brief | null = null;
  let error: string | null = null;
  const now = new Date().toISOString();
  for await (const e of argue(rec.disputeId, { ip: IP, paced: false, useModel, autopilot: { eventId: "autopilot-tick", receivedAt: now } })) {
    if (e.type === "brief") brief = e.brief;
    else if (e.type === "error") error = e.text;
  }
  return brief ? `argued with the ${brief.engine === "model" ? "model" : "rules engine"}` : `couldn't argue: ${error}`;
}

/** Step 1: the hearing on the draft, then the decision under the house rules. */
async function planLane(rec: CaseRecord): Promise<string> {
  const id = rec.disputeId;
  const d = await getDispute(id);
  if (d.status !== "WAITING_FOR_SELLER_RESPONSE") return `${id}: not with the seller yet (${d.status.toLowerCase()})`;
  if (!rec.brief) return `${id}: ${await argueLane(rec)}`;
  let hearing = rec.hearing && rec.hearing.source === "draft" ? rec.hearing : null;
  let brief = rec.brief;
  if (!hearing) {
    try {
      const r = await reviewCase(id, IP);
      hearing = r.hearing;
      brief = r.brief ?? brief;
    } catch (e) {
      // No reviewer (no model, or the budget is spent): the rules can't be met, so the case waits for the seller.
      hearing = null;
      console.error("autopilot hearing", id, (e as Error).message);
    }
  }
  const plan = planFor({ brief, hearing, amount: Number(d.dispute_amount.value), due: d.seller_response_due_date ?? null, now: Date.now() });
  await updateCase(id, (r) => (r.house ? null : { ...r, house: plan }));
  return `${id}: rule ${plan.rule}, ${plan.action === "queue" ? "left for the seller" : `${plan.action === "accept" ? "refund" : "file"} after ${HOUSE_RULES.undoMinutes} min`} (${plan.reason})`;
}

/** Step 2: send what the plan says, once the undo window has passed. */
async function sendPlan(rec: CaseRecord): Promise<string> {
  const id = rec.disputeId;
  const plan = rec.house!;
  // Read again: an undo may have landed since the list was read.
  const fresh = await loadCase(id);
  if (!fresh?.house || !planDue(fresh.house, Date.now())) return `${id}: nothing due`;
  if (isFiled(fresh.filings)) {
    await updateCase(id, (r) => ({ ...r, house: { ...r.house!, done: { at: new Date().toISOString(), summary: "Already filed by someone else; nothing sent" } } }));
    return `${id}: already filed`;
  }
  try {
    const f = await fileAction(id, plan.action as "evidence" | "accept", "autopilot", { ip: IP });
    await updateCase(id, (r) => ({ ...r, house: { ...r.house!, done: { at: f.at, summary: f.summary } } }));
    return `${id}: ${f.summary} (rule ${plan.rule})`;
  } catch (e) {
    const error = (e as Error).message;
    await updateCase(id, (r) => ({ ...r, house: { ...r.house!, failed: { at: new Date().toISOString(), error } } }));
    return `${id}: couldn't send: ${error}`;
  }
}

/** Step 3: the ruling, on PayPal's own copy of the filing. */
async function askRuling(rec: CaseRecord): Promise<string> {
  const f = await fileAction(rec.disputeId, "ruling", "autopilot", { ip: IP });
  return `${rec.disputeId}: ${f.detail ?? "asked for a ruling"} (${f.summary})`;
}

export async function autopilotTick(deadline: number, opts: { open?: string | null; lane?: boolean } = {}): Promise<TickReport> {
  const report: TickReport = { startedAt: new Date().toISOString(), steps: [], errors: [] };
  if (process.env.AUTOPILOT === "off") {
    report.steps.push("The autopilot is off");
    return report;
  }
  const step = async (label: string, need: number, fn: () => Promise<string>) => {
    if (left(deadline) < need) {
      report.steps.push(`${label}: left for the next turn (out of time)`);
      return;
    }
    try {
      report.steps.push(await fn());
    } catch (e) {
      report.errors.push(`${label}: ${(e as Error).message}`);
    }
  };
  const cases = await listCases(true);
  const lane = cases.filter((c) => c.lane === "autopilot" && !c.retired);
  const now = Date.now();

  // 2 first: sending a due plan is quick and the most time-critical.
  for (const c of lane.filter((c) => planDue(c.house, now))) await step(`send ${c.disputeId}`, 15_000, () => sendPlan(c));

  // 1: plans for lane cases with the seller and nothing decided.
  for (const c of lane.filter((c) => !c.house && !isFiled(c.filings)).slice(0, 2)) await step(`plan ${c.disputeId}`, 45_000, () => planLane(c));

  // 3: rulings, lane cases first, at most two a turn.
  const filed = cases
    .filter((c) => c.filings.some((f) => f.action === "evidence") && !c.filings.some((f) => f.action === "ruling" && f.ok !== false) && c.lastEvent?.status !== "RESOLVED")
    .sort((a, b) => Number(Boolean(b.lane)) - Number(Boolean(a.lane)) || b.openedAt.localeCompare(a.openedAt));
  let ruled = 0;
  for (const c of filed) {
    if (ruled >= 2 || left(deadline) < 50_000) break;
    const d = await getDispute(c.disputeId).catch(() => null);
    if (!d || d.status === "RESOLVED") continue;
    if (!rulingDue({ lane: c.lane === "autopilot", filings: c.filings, adjudicable: allowed(d).has("adjudicate"), now: Date.now() })) continue;
    ruled++;
    await step(`ruling ${c.disputeId}`, 45_000, () => askRuling(c));
  }

  // 4: the next lane case, once a day (or the story asked for).
  const newest = lane.map((c) => c.openedAt).sort().at(-1);
  const due = !newest || now - new Date(newest).getTime() > LANE_EVERY_HOURS * 3_600_000;
  const story = opts.open ? findScenario(opts.open) : due && opts.lane !== false && process.env.AUTOPILOT_LANE !== "off" ? findScenario(laneStoryFor(now)) : undefined;
  if (story) await step(`open ${story.id}`, 40_000, async () => `opened ${(await openCase(story, { lane: "autopilot" })).disputeId} on the seller's lane (${story.id})`);

  report.finishedAt = new Date().toISOString();
  await storage()?.write(LAST_KEY, JSON.stringify(report)).catch(() => {});
  return report;
}

export async function lastTick(): Promise<TickReport | null> {
  const r = await storage()?.read(LAST_KEY).catch(() => null);
  return r ? (JSON.parse(r.text) as TickReport) : null;
}
