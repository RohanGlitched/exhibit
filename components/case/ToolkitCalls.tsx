import type { Brief } from "@/lib/cases/types";
import { readTimes, readsDiffer } from "@/lib/cases/case-page";
import styles from "./toolkit.module.css";

/**
 * The reads the drafter made itself through PayPal's Agent Toolkit before it wrote the brief: which tool, with
 * what, when, how long PayPal took, and what came back. Each read carries its time (older reads, logged without
 * one, are placed in the drafting window), and when the autopilot's own later read found PayPal's status moved
 * on, the panel says so. Nothing shows when the brief was written without any.
 */
export default function ToolkitCalls({
  calls,
  brief,
  later,
}: {
  calls?: Brief["toolkit"];
  brief?: Pick<Brief, "createdAt" | "ms"> | null;
  /** The autopilot's own toolkit read, made later (HousePlan.read). */
  later?: { at: string; status: string | null } | null;
}) {
  if (!calls?.length) return null;
  const times = readTimes(calls, brief);
  const differ = readsDiffer(calls, brief, later);
  return (
    <section className={`sheet ${styles.calls}`} aria-labelledby="toolkit-title">
      <p className={styles.kicker}>
        <span className="bates">@paypal/agent-toolkit</span>
        <span>
          {calls.length} read{calls.length === 1 ? "" : "s"} by the drafter
        </span>
      </p>
      <h2 id="toolkit-title">What the drafter read from PayPal</h2>
      {times.window && <p className={styles.when}>Read on {times.window}.</p>}
      <ol className={styles.list}>
        {calls.map((c, i) => (
          <li key={i} data-ok={c.ok ? "true" : "false"}>
            <code className={styles.tool}>
              {c.tool}({Object.entries(c.args)
                .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
                .join(", ")})
            </code>
            <span className={styles.summary}>
              {times.each[i] && <time className={styles.at}>{times.each[i]}</time>}
              {c.ok ? c.summary : `Failed: ${c.summary}`} <small>{c.ms} ms</small>
            </span>
          </li>
        ))}
      </ol>
      {differ && <p className={styles.differ}>{differ}</p>}
      <p className={styles.foot}>
        GPT-5.6 called these itself before writing, at most three in one turn. A read is PayPal&apos;s record at that moment, not an exhibit: the brief
        cites only the lettered exhibits.
      </p>
    </section>
  );
}
