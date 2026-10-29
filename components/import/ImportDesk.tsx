"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PinnedBrief, { type Verdict } from "@/components/brief/PinnedBrief";
import ExhibitCard from "@/components/brief/ExhibitCard";
import Requirements from "@/components/case/Requirements";
import Stamp from "@/components/Stamp";
import type { Brief, Exhibit } from "@/lib/cases/types";
import type { RequirementsCard } from "@/lib/cases/requirements";
import { EXAMPLES } from "@/lib/import/examples";
import { parseExport, type OrderFields } from "@/lib/import/export";
import { LIMITS, NETWORKS, REASONS, emptyForm, validate, type ImportForm, type Problem } from "@/lib/import/input";
import styles from "./import.module.css";

type Phase = "idle" | "working" | "done" | "error";
interface Built {
  head: { id: string; reason: string; amount: string; buyer: string; order: string };
  exhibits: Exhibit[];
  card: RequirementsCard | null;
  notes: string[];
}

const STEPS = ["Reading your paste", "Lettering the exhibits", "Marking what the network asks for", "Writing the brief", "Checking every figure and name"];
const FIELD_LABEL: Record<keyof OrderFields, string> = { id: "order number", date: "date", items: "items", total: "total", shipTo: "ship-to", buyer: "buyer", email: "email" };

const fieldId = (f: string) => `f-${f.replace(/\./g, "-")}`;

export default function ImportDesk() {
  const [form, setForm] = useState<ImportForm>(emptyForm);
  const [exportText, setExportText] = useState("");
  const [exportMsg, setExportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [problems, setProblems] = useState<Problem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [built, setBuilt] = useState<Built | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [shown, setShown] = useState(0); // sentences revealed so far
  const [fallback, setFallback] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [example, setExample] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const resultRef = useRef<HTMLElement>(null);
  const problemsRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const set = <S extends "order" | "dispute" | "shipping" | "extra">(sec: S, key: keyof ImportForm[S], value: ImportForm[S][keyof ImportForm[S]]) => {
    setForm((f) => ({ ...f, [sec]: { ...f[sec], [key]: value } }));
    setExample(null);
  };
  const problemFor = (field: string) => problems.find((p) => p.field === field)?.message;

  // Sentences type onto the sheet one at a time, as they do on a sandbox case.
  useEffect(() => {
    if (!brief || shown >= brief.sentences.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 120 : 360);
    return () => clearTimeout(t);
  }, [brief, shown]);

  const build = useCallback(async (f: ImportForm, label: string | null) => {
    const local = validate(f);
    if (!local.ok) {
      setProblems(local.problems);
      setPhase("error");
      setError(null);
      requestAnimationFrame(() => problemsRef.current?.focus());
      return;
    }
    setProblems([]);
    setError(null);
    setBuilt(null);
    setBrief(null);
    setShown(0);
    setFallback(null);
    setCopied(false);
    setStep(0);
    setPhase("working");
    setExample(label);
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    try {
      const res = await fetch("/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string; problems?: Problem[] };
        if (j.problems?.length) {
          setProblems(j.problems);
          setPhase("error");
          requestAnimationFrame(() => problemsRef.current?.focus());
          return;
        }
        throw new Error(j.error ?? "Exhibit couldn't build the case. Try again in a minute.");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let done = false;
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as
            | ({ type: "case" } & Built)
            | { type: "status"; text: string }
            | { type: "brief"; brief: Brief; fallback?: string }
            | { type: "error"; text: string };
          if (ev.type === "case") {
            setBuilt({ head: ev.head, exhibits: ev.exhibits, card: ev.card, notes: ev.notes });
            setStep(3);
          } else if (ev.type === "status") setStep((s) => Math.max(s, 3));
          else if (ev.type === "brief") {
            setStep(5);
            setBrief(ev.brief);
            setFallback(ev.fallback ?? null);
            setPhase("done");
            done = true;
          } else if (ev.type === "error") throw new Error(ev.text);
        }
      }
      if (!done) throw new Error("The connection closed before the brief arrived. Try again.");
    } catch (e) {
      setError((e as Error).message || "Something went wrong.");
      setPhase("error");
    }
  }, []);

  const tryExample = (id: string) => {
    const ex = EXAMPLES.find((e) => e.id === id)!;
    const f = structuredClone(ex.form);
    setForm(f);
    setExportText("");
    setExportMsg(null);
    void build(f, ex.label);
  };

  const readExport = () => {
    const r = parseExport(exportText);
    if ("error" in r) {
      setExportMsg({ ok: false, text: r.error });
      return;
    }
    setForm((f) => ({ ...f, order: { ...f.order, ...r.fields } }));
    setExample(null);
    const missing = (Object.keys(FIELD_LABEL) as (keyof OrderFields)[]).filter((k) => !r.read.includes(k));
    setExportMsg({
      ok: true,
      text: `Read the ${r.format}: ${r.read.map((k) => FIELD_LABEL[k]).join(", ")}.${missing.length ? ` Not in it: ${missing.map((k) => FIELD_LABEL[k]).join(", ")}. Fill those in below.` : " Check the fields below."}`,
    });
  };

  const clear = () => {
    setForm(emptyForm());
    setExportText("");
    setExportMsg(null);
    setProblems([]);
    setError(null);
    setBuilt(null);
    setBrief(null);
    setPhase("idle");
    setExample(null);
  };

  const copy = async () => {
    if (!brief) return;
    const text = brief.sentences.filter((s) => s.kept).map((s) => s.text).join(" ");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const reason = form.dispute.reason;
  const verdict: Verdict | null = brief && shown >= brief.sentences.length
    ? { recommendation: brief.recommendation, odds: brief.odds, offerAmount: brief.offerAmount, headline: brief.headline, engine: brief.engine, model: brief.model, ms: brief.ms }
    : null;
  const struck = brief ? brief.sentences.filter((s) => !s.kept).length : 0;

  const field = (
    f: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    opts: { hint?: string; rows?: number; max?: number; placeholder?: string; required?: boolean; mono?: boolean; inputMode?: "decimal" | "numeric" | "email"; wide?: boolean } = {},
  ) => {
    const id = fieldId(f);
    const err = problemFor(f);
    const describedBy = [opts.hint ? `${id}-hint` : "", err ? `${id}-err` : ""].filter(Boolean).join(" ") || undefined;
    const common = {
      id,
      value,
      maxLength: opts.max,
      placeholder: opts.placeholder,
      "aria-invalid": err ? true : undefined,
      "aria-describedby": describedBy,
      "aria-required": opts.required || undefined,
      className: `${styles.input} ${opts.mono ? styles.mono : ""}`,
    };
    return (
      <div className={`${styles.field} ${opts.wide || opts.rows ? styles.wide : ""}`} data-invalid={err ? true : undefined}>
        <label htmlFor={id}>
          {label}
          {!opts.required && <span className={styles.optional}> optional</span>}
        </label>
        {opts.rows ? (
          <textarea {...common} rows={opts.rows} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
        ) : (
          <input {...common} type={opts.inputMode === "email" ? "email" : "text"} inputMode={opts.inputMode === "email" ? "email" : opts.inputMode} onChange={(e) => onChange(e.target.value)} autoComplete="off" />
        )}
        {opts.hint && (
          <p className={styles.hint} id={`${id}-hint`}>
            {opts.hint}
          </p>
        )}
        {err && (
          <p className={styles.fieldError} id={`${id}-err`}>
            {err}
          </p>
        )}
      </div>
    );
  };

  return (
    <>
      <section className={styles.examples} aria-labelledby="examples-title">
        <h2 id="examples-title" className={styles.sectionTitle}>
          Try it with an example first
        </h2>
        <ul className={styles.exampleList}>
          {EXAMPLES.map((ex) => (
            <li key={ex.id} className={`sheet ${styles.example}`}>
              <p className={styles.madeUp}>Example input (made up)</p>
              <h3>{ex.label}</h3>
              <p>{ex.blurb}</p>
              <p className={styles.exampleMeta}>
                {REASONS[ex.form.dispute.reason as keyof typeof REASONS]} · {NETWORKS[ex.form.dispute.network as keyof typeof NETWORKS].replace(/ \(.*\)$/, "")} · ${ex.form.dispute.amount}
              </p>
              <button type="button" className="btn btnQuiet" onClick={() => tryExample(ex.id)} disabled={phase === "working"}>
                Build this example
              </button>
            </li>
          ))}
        </ul>
        <p className={styles.exampleNote}>
          The shops, buyers, addresses, tracking numbers and emails in both examples are invented. Building one fills the form below, so you can see the
          shape a real paste takes.
        </p>
      </section>

      <form
        ref={formRef}
        className={styles.form}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void build(form, null);
        }}
        aria-labelledby="form-title"
      >
        <div className={styles.formHead}>
          <h2 id="form-title" className={styles.sectionTitle}>
            Your case
          </h2>
          {example && <p className={styles.loaded}>Filled from the made-up example: {example}</p>}
        </div>

        {problems.length > 0 && (
          <div className={styles.problems} role="alert" tabIndex={-1} ref={problemsRef}>
            <p>
              <strong>{problems.length === 1 ? "One thing needs fixing" : `${problems.length} things need fixing`}</strong> before Exhibit can build the case:
            </p>
            <ul>
              {problems.slice(0, 12).map((p, i) => (
                <li key={i}>
                  <a href={`#${fieldId(p.field)}`}>{p.message}</a>
                </li>
              ))}
            </ul>
          </div>
        )}

        <fieldset className={`sheet ${styles.part}`}>
          <legend className={styles.partHead}>
            <span className={styles.sticker}>1</span>
            The order
          </legend>
          <details className={styles.export} open={exportText.length > 0 || undefined}>
            <summary>Paste an order export instead (CSV or JSON)</summary>
            <div className={styles.exportBody}>
              <label htmlFor="f-export" className={styles.srOnlyLabel}>
                Order export
              </label>
              <textarea
                id="f-export"
                className={`${styles.input} ${styles.mono}`}
                rows={5}
                maxLength={20_000}
                value={exportText}
                onChange={(e) => setExportText(e.target.value)}
                placeholder={"Name,Created at,Total,Lineitem quantity,Lineitem name,Lineitem price,Shipping Name,…\n#1042,2026-10-02 18:41,62.00,2,Beeswax tapers,18.00,Jordan Avery,…"}
                spellCheck={false}
                aria-describedby="f-export-hint"
              />
              <p className={styles.hint} id="f-export-hint">
                A CSV with its header row (Shopify, WooCommerce and most stores export one; rows for the same order are read as its items), or one
                order as JSON (Shopify, WooCommerce or PayPal Orders v2). It fills the fields below; nothing is sent until you build the case.
              </p>
              <div className={styles.exportRow}>
                <button type="button" className="btn btnQuiet" onClick={readExport} disabled={!exportText.trim()}>
                  Fill the form from it
                </button>
                {exportMsg && (
                  <p className={exportMsg.ok ? styles.readOk : styles.fieldError} role="status">
                    {exportMsg.text}
                  </p>
                )}
              </div>
            </div>
          </details>
          <div className={styles.grid}>
            {field("order.id", "Order number", form.order.id, (v) => set("order", "id", v), { required: true, max: 40, placeholder: "1042" })}
            {field("order.date", "Ordered on", form.order.date, (v) => set("order", "date", v), { required: true, max: LIMITS.short, placeholder: "2 Oct 2026 or 2026-10-02 18:41" })}
            {field("order.total", "Order total (USD)", form.order.total, (v) => set("order", "total", v), { required: true, max: 20, placeholder: "62.00", inputMode: "decimal" })}
            {field("order.buyer", "Buyer's name", form.order.buyer, (v) => set("order", "buyer", v), { required: true, max: LIMITS.short, placeholder: "Jordan Avery" })}
            {field("order.email", "Buyer's email", form.order.email, (v) => set("order", "email", v), { max: 120, inputMode: "email", placeholder: "jordan@example.com" })}
            {field("order.shipTo", "Ship to", form.order.shipTo, (v) => set("order", "shipTo", v), { required: true, max: LIMITS.line, wide: true, placeholder: "Jordan Avery, 2214 NE Alberta St, Portland, OR 97211", hint: "Name and address on one line, with the ZIP: the requirements card matches it to the delivery scan." })}
            {field("order.items", "Items", form.order.items, (v) => set("order", "items", v), { required: true, rows: 3, max: LIMITS.items, placeholder: "2 × Beeswax taper candles, $18.00\n1 × Brass candle holder, $26.00", hint: "One per line: quantity, name, and the price of one." })}
          </div>
        </fieldset>

        <fieldset className={`sheet ${styles.part}`}>
          <legend className={styles.partHead}>
            <span className={styles.sticker}>2</span>
            The dispute
          </legend>
          <div className={styles.grid}>
            <div className={styles.field}>
              <label htmlFor={fieldId("dispute.reason")}>Reason the buyer gave</label>
              <select id={fieldId("dispute.reason")} className={styles.input} value={reason} onChange={(e) => set("dispute", "reason", e.target.value)} aria-invalid={problemFor("dispute.reason") ? true : undefined}>
                {Object.entries(REASONS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor={fieldId("dispute.network")}>How it reached you</label>
              <select id={fieldId("dispute.network")} className={styles.input} value={form.dispute.network} onChange={(e) => set("dispute", "network", e.target.value)}>
                {Object.entries(NETWORKS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            {field("dispute.amount", "Amount disputed (USD)", form.dispute.amount, (v) => set("dispute", "amount", v), { max: 20, inputMode: "decimal", placeholder: "the order total", hint: "Leave empty for the whole order." })}
            {form.dispute.network !== "PAYPAL" &&
              field("dispute.last4", "Card's last four digits", form.dispute.last4, (v) => set("dispute", "last4", v.replace(/\D/g, "")), { max: 4, inputMode: "numeric", placeholder: "4242", hint: "Only the last four. Never paste a full card number." })}
            {field("dispute.caseId", "PayPal case id", form.dispute.caseId, (v) => set("dispute", "caseId", v), { max: 40, placeholder: "PP-R-ABC-12345678", mono: true })}
            {field("dispute.respondBy", "Respond by", form.dispute.respondBy, (v) => set("dispute", "respondBy", v), { max: LIMITS.short, placeholder: "21 Oct 2026" })}
            {(reason === "UNAUTHORISED" || reason === "DUPLICATE_TRANSACTION") &&
              field("dispute.paymentId", "Disputed transaction id", form.dispute.paymentId, (v) => set("dispute", "paymentId", v), { max: 40, mono: true, placeholder: "8MC585209K746392H" })}
            {field("dispute.claim", "What the buyer said", form.dispute.claim, (v) => set("dispute", "claim", v), { rows: 2, max: LIMITS.claim, placeholder: "The cardholder says the order never arrived." })}
          </div>
        </fieldset>

        <fieldset className={`sheet ${styles.part}`}>
          <legend className={styles.partHead}>
            <span className={styles.sticker}>3</span>
            Shipping and tracking
          </legend>
          <div className={styles.grid}>
            {field("shipping.carrier", "Carrier", form.shipping.carrier, (v) => set("shipping", "carrier", v), { max: 40, placeholder: "USPS" })}
            {field("shipping.tracking", "Tracking number", form.shipping.tracking, (v) => set("shipping", "tracking", v), { max: 40, mono: true, placeholder: "9400 1118 9922 3344 5566 77" })}
            <div className={`${styles.field} ${styles.wide}`}>
              <label className={styles.check}>
                <input type="checkbox" checked={form.shipping.onPayPal} onChange={(e) => set("shipping", "onPayPal", e.target.checked)} />
                <span>I added this tracking number to the PayPal transaction</span>
              </label>
            </div>
            {field("shipping.scans", "Carrier scans", form.shipping.scans, (v) => set("shipping", "scans", v), {
              rows: 5,
              max: LIMITS.scans,
              mono: true,
              placeholder: "October 6, 2026, 2:14 pm  Delivered, Front Door/Porch  PORTLAND, OR 97211\nOctober 6, 2026, 7:02 am  Out for Delivery  PORTLAND, OR 97211",
              hint: "Copy the scan history from the carrier's tracking page, one scan per line, newest or oldest first.",
            })}
          </div>
        </fieldset>

        <fieldset className={`sheet ${styles.part}`}>
          <legend className={styles.partHead}>
            <span className={styles.sticker}>4</span>
            Emails with the buyer
          </legend>
          <div className={styles.grid}>
            {field("emails", "The thread", form.emails, (v) => setForm((f) => ({ ...f, emails: v })), {
              rows: 6,
              max: LIMITS.emails,
              placeholder: "From: Jordan Avery <jordan@example.com>\nDate: Oct 8, 2026, 10:12 AM\n\nHi, my order never arrived…\n\nor one per line:  8 Oct 2026, 10:12, Jordan: Hi, my order never arrived…",
              hint: "Paste it from your mail app with its From: and Date: lines, or write one message per line starting with the date and who wrote it. Quoted replies are dropped.",
            })}
          </div>
        </fieldset>

        <fieldset className={`sheet ${styles.part}`}>
          <legend className={styles.partHead}>
            <span className={styles.sticker}>5</span>
            {reason === "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED"
              ? "The listing and your policy"
              : reason === "UNAUTHORISED"
                ? "What ties the cardholder to the order"
                : reason === "DUPLICATE_TRANSACTION"
                  ? "The refund and the second charge"
                  : "Anything else"}
          </legend>
          <div className={styles.grid}>
            {reason === "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED" && (
              <>
                {field("extra.listing", "The listing, as the buyer saw it", form.extra.listing, (v) => set("extra", "listing", v), { rows: 4, max: LIMITS.extra, hint: "The product description. The card looks for words that disclose the difference the buyer complains about." })}
                {field("extra.policy", "Your return policy", form.extra.policy, (v) => set("extra", "policy", v), { rows: 2, max: LIMITS.extra })}
              </>
            )}
            {reason === "UNAUTHORISED" && (
              <>
                {field("extra.billing", "Billing address", form.extra.billing, (v) => set("extra", "billing", v), { max: LIMITS.line, wide: true, hint: "Only matters when it differs from the ship-to." })}
                {field("extra.avs", "Address check (AVS) result", form.extra.avs, (v) => set("extra", "avs", v.toUpperCase()), { max: 1, placeholder: "Y" })}
                {field("extra.cvv", "Security code (CVV) result", form.extra.cvv, (v) => set("extra", "cvv", v.toUpperCase()), { max: 1, placeholder: "M" })}
                {field("extra.history", "This customer's earlier orders", form.extra.history, (v) => set("extra", "history", v), { rows: 3, max: LIMITS.extra, placeholder: "#1012, 12 Aug 2026: Brass candle holder, $26.00. Delivered, no issues.", hint: "One per line. Say whether each was delivered without a dispute." })}
              </>
            )}
            {reason === "DUPLICATE_TRANSACTION" && (
              <>
                {field("extra.refundId", "Refund id of the duplicate", form.extra.refundId, (v) => set("extra", "refundId", v), { max: 40, mono: true })}
                {field("extra.refundAmount", "Refund amount (USD)", form.extra.refundAmount, (v) => set("extra", "refundAmount", v), { max: 20, inputMode: "decimal" })}
                {field("extra.refundDate", "Refunded on", form.extra.refundDate, (v) => set("extra", "refundDate", v), { max: LIMITS.short })}
                {field("extra.secondPayment", "Second charge's transaction id", form.extra.secondPayment, (v) => set("extra", "secondPayment", v), { max: 40, mono: true })}
              </>
            )}
            {field("extra.notes", "Your notes on the order", form.extra.notes, (v) => set("extra", "notes", v), { rows: 2, max: LIMITS.extra, hint: "Shown as its own exhibit. Write facts you could show, not arguments." })}
          </div>
        </fieldset>

        <div className={styles.submit}>
          <button type="submit" className="btn btnPrimary" disabled={phase === "working"}>
            {phase === "working" ? "Building the case…" : "Build the case"}
          </button>
          <button type="button" className="btn btnQuiet" onClick={clear} disabled={phase === "working"}>
            Clear the form
          </button>
          <p>Nothing is filed, nothing is sent to PayPal, and nothing you paste is stored.</p>
        </div>
      </form>

      <section className={styles.result} ref={resultRef} aria-labelledby="result-title" aria-busy={phase === "working"}>
        <h2 id="result-title" className={styles.sectionTitle}>
          The case
        </h2>

        {phase === "idle" && !built && (
          <div className={`sheet ${styles.placeholder}`}>
            <p className={styles.placeholderKicker}>Nothing built yet</p>
            <p>
              Your exhibits, lettered A, B, C, appear here, then the requirements card for the reason code, then a brief in which every sentence is pinned
              to the exhibit that proves it and checked against it.
            </p>
            <p>Build one of the made-up examples above to see it, or fill in your own case.</p>
          </div>
        )}

        {phase === "working" && !built && (
          <div className={`sheet ${styles.placeholder}`} role="status">
            <ol className={styles.steps}>
              {STEPS.map((s, i) => (
                <li key={s} data-state={i < step ? "done" : i === step ? "now" : "todo"}>
                  {s}
                </li>
              ))}
            </ol>
          </div>
        )}

        {phase === "error" && error && (
          <div className={`sheet ${styles.failed}`} role="alert">
            <p className={styles.placeholderKicker}>The case didn&apos;t build</p>
            <p>{error}</p>
            <button type="button" className="btn btnQuiet" onClick={() => void build(form, example)}>
              Try again
            </button>
          </div>
        )}
        {phase === "error" && !error && problems.length > 0 && !built && (
          <div className={`sheet ${styles.placeholder}`}>
            <p className={styles.placeholderKicker}>Waiting on the form</p>
            <p>Fix the {problems.length === 1 ? "field" : "fields"} marked above, then build the case again.</p>
          </div>
        )}

        {built && (
          <>
            <p className={styles.provenance}>
              <strong>From your paste, not read from PayPal.</strong> Exhibit hasn&apos;t checked these records with PayPal, the carrier or your store, and
              hasn&apos;t filed anything. {example ? `This is the made-up example “${example}”.` : ""}
            </p>
            {built.notes.length > 0 && (
              <ul className={styles.readNotes} aria-label="What Exhibit noticed while reading your paste">
                {built.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
            <div className={styles.desk}>
              <PinnedBrief
                stamp={brief && verdict ? <Stamp word="DRAFT" line="NOT FILED · FROM YOUR PASTE" tone="ink" /> : null}
                head={{ id: built.head.id, reason: built.head.reason, amount: built.head.amount, buyer: built.head.buyer, order: built.head.order }}
                exhibits={built.exhibits}
                sentences={brief ? brief.sentences.slice(0, shown) : []}
                tally={verdict && brief ? brief.tally : []}
                verdict={verdict}
                status={brief && shown < brief.sentences.length ? STEPS[4] : null}
                placeholder={
                  phase === "working" ? (
                    <ol className={styles.steps}>
                      {STEPS.map((s, i) => (
                        <li key={s} data-state={i < step ? "done" : i === step ? "now" : "todo"}>
                          {s}
                        </li>
                      ))}
                    </ol>
                  ) : null
                }
                below={
                  brief && verdict ? (
                    <div className={`sheet ${styles.next}`}>
                      <h3>What to do with it</h3>
                      <p>
                        Exhibit doesn&apos;t file pasted cases. If this is a real case, read the response against your own records, then paste it into
                        PayPal&apos;s Resolution Center yourself with the evidence types below.
                        {struck > 0 ? ` ${struck === 1 ? "One sentence was" : `${struck} sentences were`} struck by the checker and left out of the copy.` : ""}
                      </p>
                      {brief.evidenceTypes.length > 0 && (
                        <p className={styles.evidence}>
                          Evidence types:{" "}
                          {brief.evidenceTypes.map((t) => (
                            <code key={t}>{t}</code>
                          ))}
                        </p>
                      )}
                      {fallback && <p className={styles.fallback}>{fallback}</p>}
                      <div className={styles.nextButtons}>
                        <button type="button" className="btn btnPrimary" onClick={copy}>
                          {copied ? "Copied" : "Copy the response"}
                        </button>
                        <button type="button" className="btn btnQuiet" onClick={() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                          Edit the paste
                        </button>
                      </div>
                    </div>
                  ) : null
                }
              />
            </div>
            <section className={styles.exhibitList} aria-labelledby="exhibit-list-title">
              <h3 id="exhibit-list-title" className={styles.listTitle}>
                The exhibits, A to {built.exhibits[built.exhibits.length - 1]?.id}, from your paste
              </h3>
              {built.exhibits.map((e) => (
                <ExhibitCard key={e.id} exhibit={e} full />
              ))}
            </section>
            {built.card && (
              <div className={styles.card}>
                <Requirements card={built.card} />
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
