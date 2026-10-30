/**
 * The autopilot's audit lines on a case page, as plain data: each step it took, the house rule it acted under,
 * how long after PayPal's webhook, and (for a hearing, or a ruling that followed one) the anchor of the
 * transcript it rests on. Pure, so the tests can check the words against the records they come from.
 */
import type { Hearing } from "./hearing";
import type { CaseRecord, Filing } from "./types";
import { sinceWords, type HousePlan } from "./autopilot";
import { draftHearingFor, hearingAnchor, latestOn } from "./hearing-log";
import { utcTime } from "../format";

export interface AuditLine {
  at: string;
  text: string;
  /** The anchor of the hearing transcript this line rests on, when the case page shows it. */
  hearing?: string;
  /** Said when the line names a hearing whose transcript the record no longer holds. */
  missing?: string;
}

export interface AuditInput {
  rec: Pick<CaseRecord, "autopilot" | "house" | "events"> | null;
  filings: Pick<Filing, "action" | "at" | "ok" | "summary" | "detail">[];
  hearings: Hearing[];
  /** PayPal's status for the case now. */
  status: string;
  /** PayPal offers a ruling on the case now. */
  adjudicable: boolean;
}

/** The side a ruling request asked for, from the line fileAction writes ("Asked the sandbox to rule for the buyer"). */
export function rulingSide(f: Pick<Filing, "detail" | "summary">): "seller" | "buyer" | null {
  const m = `${f.detail ?? ""} ${f.summary ?? ""}`.match(/rule for the (seller|buyer)/);
  return m ? (m[1] as "seller" | "buyer") : null;
}

const byAutopilot = (f: Pick<Filing, "action" | "detail">) => f.action === "ruling" && /by the autopilot/.test(f.detail ?? "");

/** Draft hearings recorded before every hearing was kept (30 Oct 2026) were overwritten by the next one. */
const KEPT_FROM = "2026-10-30T00:00:00Z";

export function houseAudit(i: AuditInput): AuditLine[] {
  const rec = i.rec;
  const hook = rec?.autopilot?.receivedAt ?? null;
  const after = (at: string) => (hook ? ` ${sinceWords(hook, at)} after PayPal's webhook` : "");
  const audit: AuditLine[] = [];
  if (rec?.autopilot) audit.push({ at: rec.autopilot.arguedAt, text: `Argued by the autopilot${after(rec.autopilot.arguedAt)}, with the ${rec.autopilot.engine === "model" ? "model" : "rules engine"}` });
  const p: HousePlan | undefined = rec?.house;
  if (p) {
    if (p.read)
      audit.push({
        at: p.read.at,
        text: p.read.error
          ? `Couldn't read the case through PayPal's Agent Toolkit (${p.read.error}); read it with Exhibit's own client`
          : `Read through PayPal's Agent Toolkit: get_dispute (${(p.read.status ?? "unknown").toLowerCase().replace(/_/g, " ")}${p.read.due ? `, due ${utcTime(p.read.due)}` : ""})${p.read.tracking ? ` and get_shipment_tracking (${p.read.tracking})` : ""}`,
      });
    if (p.hearing) {
      const h = draftHearingFor(i.hearings, p.decidedAt);
      const text = `Heard on the draft: ${p.hearing.objections} objection${p.hearing.objections === 1 ? "" : "s"}, ${p.hearing.overruled} overruled, ${p.hearing.sustained} sustained; the reviewer found for the ${p.hearing.side}`;
      audit.push(
        h
          ? { at: p.decidedAt, text, hearing: hearingAnchor(h) }
          : { at: p.decidedAt, text, missing: p.decidedAt < KEPT_FROM ? "transcript not kept: recorded before 30 Oct" : "transcript not kept" },
      );
    }
    audit.push({ at: p.decidedAt, text: `Decided${after(p.decidedAt)} under house rule ${p.rule}: ${p.action === "queue" ? "left for the seller" : p.action === "accept" ? "refund" : "file the response"}. ${p.reason}` });
    if (p.undone) audit.push({ at: p.undone.at, text: "Stopped in the undo window; the case waits for the seller" });
    if (p.done) audit.push({ at: p.done.at, text: `${p.action === "accept" ? "Refunded" : "Filed"} by the autopilot${after(p.done.at)} under house rule ${p.rule}: ${p.done.summary}` });
    if (p.failed) audit.push({ at: p.failed.at, text: `Couldn't send: ${p.failed.error}` });
  }
  const resolved = i.status === "RESOLVED";
  for (const f of i.filings.filter((f) => byAutopilot(f) && f.ok !== false)) {
    // The hearing on PayPal's copy that the request followed: the one carrying the panel's split, else the latest
    // one held before it (requests made before 30 Oct followed a single hearing).
    const h = i.hearings.filter((x) => x.source === "paypal" && x.panel && x.at <= f.at).at(-1) ?? latestOn(i.hearings, "paypal", f.at);
    const side = rulingSide(f);
    const text = resolved
      ? `Ruling asked for by the autopilot${after(f.at)} under house rule 5: ${f.summary}`
      : `Ruling asked for by the autopilot${after(f.at)} under house rule 5${side ? `, for the ${side}` : ""}: ${f.summary.replace(/[.\s]+$/, "")}. PayPal took the request but hasn't ruled; the case is still under review`;
    audit.push(h ? { at: f.at, text, hearing: hearingAnchor(h) } : { at: f.at, text });
  }
  // A filed fight with no ruling asked yet: say what the autopilot will ask for, and that PayPal hasn't opened it.
  const filed = i.filings.filter((f) => f.action === "evidence").map((f) => f.at).sort().at(-1);
  const asked = i.filings.some((f) => f.action === "ruling" && f.ok !== false);
  if (p && filed && !asked && !resolved && !i.adjudicable) {
    const h = i.hearings.filter((x) => x.source === "paypal" && x.at >= filed).at(-1) ?? null;
    audit.push({
      at: filed,
      text: h
        ? `Will ask for a ruling for the ${h.verdict.side} once PayPal opens it (house rule 5), as the hearing on PayPal's copy found`
        : "Will ask for the ruling the hearing on PayPal's copy reaches once PayPal opens the case for one (house rule 5)",
      ...(h ? { hearing: hearingAnchor(h) } : {}),
    });
  }
  for (const e of rec?.events ?? []) {
    if (e.type === "CUSTOMER.DISPUTE.RESOLVED") audit.push({ at: e.receivedAt, text: `PayPal sent CUSTOMER.DISPUTE.RESOLVED${after(e.receivedAt)}: ${e.status.toLowerCase().replace(/_/g, " ")}${e.outcome ? `, ${e.outcome.toLowerCase().replace(/_/g, " ")}` : ""}` });
  }
  // Stable order by time; steps with the same time keep the order they were written in.
  return audit.map((a, k) => ({ a, k })).sort((x, y) => x.a.at.localeCompare(y.a.at) || x.k - y.k).map((x) => x.a);
}
