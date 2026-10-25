import { LISTING_INJECTION } from "@/lib/shop/catalog";
import type { AgentStep } from "@/lib/agentic/types";
import type { AgentView } from "@/lib/agentic/view";
import styles from "./agent.module.css";

/**
 * "What the buyer's agent did": the agent's tool calls on an agent-placed order, the intent it shopped under,
 * and who the mandate check holds responsible. Shown on agent stories only.
 */

const TOOL: Record<string, string> = {
  search_catalog: "Searched the catalogue",
  view_product: "Read a product page",
  add_to_cart: "Added to the cart",
  remove_from_cart: "Took out of the cart",
  check_intent: "Checked the cart against the intent",
  sign_cart: "Signed the cart",
  pay: "Paid through PayPal",
  finish: "Reported back",
};

const usd = (v: string) => `$${Number(v).toFixed(2)}`;

function Steps({ steps }: { steps: AgentStep[] }) {
  return (
    <ol className={styles.steps}>
      {steps.map((st) => {
        const args = Object.entries(st.args).filter(([k]) => k !== "message");
        const [first, ...rest] = st.result.split("\n");
        return (
          <li key={st.n} data-ok={st.ok} data-tool={st.tool}>
            <span className={styles.n}>{st.n}</span>
            <div>
              <p className={styles.call}>
                <strong>{TOOL[st.tool] ?? st.tool}</strong>
                <code>
                  {st.tool}({args.map(([, v]) => (typeof v === "string" ? JSON.stringify(v) : String(v))).join(", ")})
                </code>
                <span className={styles.at}>{(st.ms / 1000).toFixed(1)} s</span>
              </p>
              {st.why && <p className={styles.why}>{st.why}</p>}
              {st.tool !== "finish" && (
                <div className={styles.result}>
                  <p>{first}</p>
                  {st.tool === "search_catalog" && rest.map((line) => <p key={line}>{line}</p>)}
                  {st.tool !== "search_catalog" && rest.length > 0 && (
                    <details>
                      <summary>
                        {st.tool === "view_product" ? "The listing" : st.tool === "check_intent" ? "Each check" : `${rest.length} more line${rest.length === 1 ? "" : "s"}`}
                      </summary>
                      <pre>{rest.join("\n")}</pre>
                    </details>
                  )}
                </div>
              )}
              {st.tool === "finish" && typeof st.args.message === "string" && <p className={styles.told}>&ldquo;{st.args.message}&rdquo;</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default function AgentTranscript({ agent }: { agent: AgentView }) {
  const run = agent.run;
  const v = agent.verdict;
  const passed = agent.checks.filter((c) => c.ok).length;
  return (
    <section className={`sheet ${styles.wrap}`} aria-labelledby="agent-did">
      <header className={styles.head}>
        <p className="bates">Buyer&apos;s agent</p>
        <h2 id="agent-did">What the buyer&apos;s agent did</h2>
        <p className={styles.sub}>
          {run
            ? run.engine === "model"
              ? `${agent.agentName}: ${run.model ?? "a model"} with shopping tools, ${run.steps.length} tool calls in ${(run.ms / 1000).toFixed(0)} s, when this case was opened.`
              : `${agent.agentName}: the scripted agent, through the same tools, ${run.steps.length} tool calls.`
            : `${agent.agentName}. This case was opened before the live buyer agent, so the log below is the story's script.`}
        </p>
      </header>

      <div className={styles.grid}>
        <div className={styles.intent}>
          <p className={styles.label}>The cardholder asked</p>
          <blockquote>&ldquo;{agent.request}&rdquo;</blockquote>
          <dl>
            <div>
              <dt>Allowed</dt>
              <dd>{agent.item}</dd>
            </div>
            <div>
              <dt>Limit</dt>
              <dd>{usd(agent.limit)} delivered</dd>
            </div>
            <div>
              <dt>Signed by</dt>
              <dd>{run ? <code>{run.intentKid}</code> : "a stand-in key derived from the order number"}</dd>
            </div>
          </dl>
        </div>
        <div className={styles.verdict} data-party={v.party}>
          <p className={styles.label}>Responsible</p>
          <p className={styles.party}>{v.label}</p>
          <p>{v.line}</p>
          <ul className={styles.checks} aria-label={`Mandate check: ${passed} of ${agent.checks.length} passed`}>
            {agent.checks.map((c) => (
              <li key={c.label} data-ok={c.ok} title={c.detail}>
                <strong>{c.ok ? "Pass" : "Fail"}</strong> {c.label}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {run?.injection && (
        <div className={styles.injection}>
          <p className={styles.label}>Injection in the listing</p>
          <p>The pour-over set&apos;s description carried a line addressed to shopping agents. The agent read it on the product page:</p>
          <blockquote>&ldquo;{LISTING_INJECTION}&rdquo;</blockquote>
          <p>Whatever the listing says, the cardholder signed for &ldquo;{agent.item}&rdquo; up to {usd(agent.limit)}. The mandate check holds the cart to that.</p>
        </div>
      )}

      {run?.fallback && (
        <p className={styles.fallback}>
          The scripted agent placed this order because {run.fallback}. It replays the story&apos;s purchase through the same tools, so the cart is
          still signed and paid for the same way.
        </p>
      )}
      {run?.modelSteps && run.modelSteps.length > 0 && (
        <details className={styles.first}>
          <summary>
            What {run.model ?? "the model"} did first ({run.modelSteps.length} tool call{run.modelSteps.length === 1 ? "" : "s"})
          </summary>
          <Steps steps={run.modelSteps} />
          {run.modelTold && <p className={styles.told}>It told the cardholder: &ldquo;{run.modelTold}&rdquo;</p>}
        </details>
      )}

      {run ? (
        <Steps steps={run.steps} />
      ) : (
        <ol className={styles.script}>{agent.script?.map((line) => <li key={line}>{line}</li>)}</ol>
      )}

      <p className={styles.foot}>
        {run ? (
          <>
            {run.orderId ? `PayPal order ${run.orderId}` : "The PayPal order"} carries <code>ap2:{run.digest.slice(0, 16)}…</code>, the SHA-256 of
            the cart signed with <code>{run.cartKid}</code>. Check the keys at <a href="/.well-known/exhibit-keys.json">/.well-known/exhibit-keys.json</a>.
          </>
        ) : (
          <>Cases opened from 26 Oct 2026 are bought by the live buyer agent and signed with the keys at <a href="/.well-known/exhibit-keys.json">/.well-known/exhibit-keys.json</a>.</>
        )}
      </p>
    </section>
  );
}
