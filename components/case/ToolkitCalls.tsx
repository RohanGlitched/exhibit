import type { Brief } from "@/lib/cases/types";
import styles from "./toolkit.module.css";

/**
 * The reads the drafter made itself through PayPal's Agent Toolkit before it wrote the brief: which tool, with
 * what, how long PayPal took, and what came back. Nothing shows when the brief was written without any.
 */
export default function ToolkitCalls({ calls }: { calls?: Brief["toolkit"] }) {
  if (!calls?.length) return null;
  return (
    <section className={`sheet ${styles.calls}`} aria-labelledby="toolkit-title">
      <p className={styles.kicker}>
        <span className="bates">@paypal/agent-toolkit</span>
        <span>
          {calls.length} read{calls.length === 1 ? "" : "s"} by the drafter
        </span>
      </p>
      <h2 id="toolkit-title">What the drafter read from PayPal</h2>
      <ol className={styles.list}>
        {calls.map((c, i) => (
          <li key={i} data-ok={c.ok ? "true" : "false"}>
            <code className={styles.tool}>
              {c.tool}({Object.entries(c.args)
                .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
                .join(", ")})
            </code>
            <span className={styles.summary}>
              {c.ok ? c.summary : `Failed: ${c.summary}`} <small>{c.ms} ms</small>
            </span>
          </li>
        ))}
      </ol>
      <p className={styles.foot}>
        GPT-5.6 called these itself before writing, at most three in one turn. A read is PayPal&apos;s record, not an exhibit: the brief cites only the lettered exhibits.
      </p>
    </section>
  );
}
