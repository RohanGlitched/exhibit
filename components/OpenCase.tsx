"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "@/app/new/new.module.css";

interface Option {
  id: string;
  title: string;
  blurb: string;
  reason: string;
  amount: string;
  buyer: string;
}

const STEPS = ["Taking the buyer's card payment", "Adding the tracking number", "Filing the chargeback", "Putting the case on your desk"];

export default function OpenCase({ cases }: { cases: Option[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function open(id: string) {
    setBusy(id);
    setError(null);
    setStep(0);
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 1400);
    try {
      const r = await fetch("/api/cases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: id }) });
      const j = (await r.json()) as { id?: string; error?: string };
      if (!r.ok || !j.id) throw new Error(j.error ?? "PayPal didn't open the case.");
      setStep(STEPS.length - 1);
      router.push(`/case/${j.id}?argue=1`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    } finally {
      clearInterval(timer);
    }
  }

  return (
    <>
      <ol className={styles.list}>
        {cases.map((c) => (
          <li key={c.id} className={`sheet ${styles.item}`} data-busy={busy === c.id}>
            <div className={styles.meta}>
              <span className={styles.reason}>{c.reason}</span>
              <span>{c.amount}</span>
            </div>
            <h2>{c.title}</h2>
            <p>{c.blurb}</p>
            <div className={styles.row}>
              <span className={styles.buyer}>Buyer: {c.buyer}</span>
              <button className="btn btnPrimary" onClick={() => open(c.id)} disabled={busy !== null}>
                {busy === c.id ? "Opening…" : "Open this case"}
              </button>
            </div>
            {busy === c.id && (
              <ol className={styles.steps} aria-live="polite">
                {STEPS.map((s, i) => (
                  <li key={s} data-state={i < step ? "done" : i === step ? "now" : "next"}>
                    {s}
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ol>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
