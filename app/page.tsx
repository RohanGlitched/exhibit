import Image from "next/image";
import Link from "next/link";
import HomeStage from "@/components/hero/HomeStage";
import Docket from "@/components/home/Docket";
import ExhibitWall from "@/components/home/ExhibitWall";
import PdfSpread from "@/components/home/PdfSpread";
import Pleading from "@/components/home/Pleading";
import { deskStats, showcase } from "@/lib/showcase";
import { usd } from "@/lib/format";
import { DISPUTE_FEE, FIGURES } from "@/lib/impact";
import { cartFor, intentFor, shipLine } from "@/lib/agentic/story";
import { customIdFor, priceCart, signMandate, verifyAgentOrder } from "@/lib/agentic/mandate";
import { sampleKeys } from "@/lib/agentic/keys";
import { scenario } from "@/lib/shop/scenarios";
import proof from "@/data/proof.json";
import reviewProof from "@/data/review-proof.json";
import Exchange from "@/components/case/Exchange";
import { homeLive } from "@/lib/home-live";
import SectionIndex from "@/components/page/SectionIndex";
import { utcStamp } from "@/lib/webhooks/paypal";
import styles from "./home.module.css";

// The figures come from the desk's own snapshot (read at most once a minute); the page keeps to the same minute.
export const revalidate = 60;

const STEPS = [
  {
    title: "Read the case",
    text: "A buyer disputes a payment. Exhibit reads the case from PayPal: the reason, the amount, the deadline, and what PayPal will accept as a response.",
    api: "GET /v1/customer/disputes/{id}",
  },
  {
    title: "Gather the records",
    text: "It pulls the order, the payment and the issuer's address checks, the tracking on file, the carrier's scans, the emails and the listing. Each becomes a numbered exhibit.",
    api: "GET /v2/checkout/orders/{id} and /v2/payments/captures/{id}",
  },
  {
    title: "Argue it",
    text: "GPT-5.6 on Azure OpenAI weighs the exhibits, tallies the points for each side, recommends fighting or refunding, and writes the response with an exhibit mark on every sentence.",
    api: "Azure OpenAI Responses API, one forced tool call (Bedrock Converse ready)",
  },
  {
    title: "Check every sentence",
    text: "Before anything is filed, every figure and name in the response (amounts, dates, ids, ZIPs, carriers, signers) is matched against the record it cites, along with the words it quotes. Anything unmatched is struck, and you see why; a sentence with nothing to match is marked unverified.",
    api: "Runs on Exhibit's server, no model involved",
  },
  {
    title: "File it with PayPal",
    text: "You approve with one click. Exhibit files the evidence with tracking details and a Bates-stamped PDF, or accepts the claim and refunds, through the Disputes API.",
    api: "POST /provide-evidence or /accept-claim",
  },
];

/**
 * A labelled sample: the mandate check on a sample agent order, run by the same code as a case, with throwaway
 * keys and a sample order (no PayPal record). Real agent cases show theirs on the case page.
 */
function sampleMandateCheck() {
  const s = scenario("agent-mandate", { buyer: 1 })!;
  const at = new Date("2026-10-04T17:30:00.000Z");
  const keys = sampleKeys();
  const intent = signMandate(intentFor(s, at, "intent_sample"), keys.wallet);
  const shipTo = shipLine(s.buyer.shipTo);
  const cart = signMandate(cartFor(s, intent.mandate, priceCart(s.items), shipTo, at, "cart_sample"), keys.agent);
  const c = cart.mandate;
  return verifyAgentOrder(
    intent,
    cart,
    { id: "SAMPLE", customId: customIdFor(cart), total: c.total, shipTo: c.shipTo, items: c.items.map((x) => ({ sku: x.sku, quantity: x.quantity })), createdAt: at.toISOString() },
    keys.resolve,
  );
}

export default async function Home() {
  const [show, stats, live] = await Promise.all([
    showcase().catch(() => null),
    deskStats().catch(() => null),
    homeLive().catch(() => ({ hearing: null, lane: null, agent: null })),
  ]);
  const sample = sampleMandateCheck();
  // The sticky index under the hero: one chip per section the page draws.
  const index = [
    { id: "checker", label: "The checker" },
    ...(show ? [{ id: "exhibits", label: "Exhibits" }] : []),
    { id: "how", label: "How a case moves" },
    ...(show ? [{ id: "filing", label: "What reaches PayPal" }] : []),
    ...(live.hearing ? [{ id: "cross-examination", label: "Cross-examination" }] : []),
    ...(live.lane || live.agent ? [{ id: "zero-touch", label: "Zero-touch" }] : []),
    { id: "platform", label: "PayPal APIs" },
    { id: "refund", label: "When to refund" },
    { id: "agents", label: "Agent purchases" },
    { id: "measured", label: "Measured" },
    { id: "cost", label: "What a dispute costs" },
    { id: "phone", label: "On a phone" },
    { id: "try", label: "Try it" },
  ];
  return (
    <main>
      <section className={`shell ${styles.hero}`}>
        <div className={styles.heroText}>
          <h1>
            Cross{"‑"}examined before PayPal{" "}
            <span className={styles.nowrap}>
              reads it.<span className={styles.sticker} data-side="respondent">A</span>
            </span>
          </h1>
          <div className={styles.heroSide}>
            <p>
              Exhibit argues a small PayPal seller&apos;s disputes, then holds a hearing on the PDF PayPal will read, pressed by the card
              network&apos;s requirements. An answer stands only when the checker matches it to the record it cites.
            </p>
            <div className={styles.ctas}>
              <Link className="btn btnPrimary" href="/new">
                Open a sandbox case
              </Link>
              <Link className="btn btnQuiet" href="/desk">
                See the desk
              </Link>
            </div>
            <p className={styles.heroNote}>
              On 16 of 18 held-out free-text runs (9 cases &times; 2 customers, written and labelled by a separate AI agent), it made the right call; a
              rules baseline that reads every structured record made it twice. <Link href="/proof#held-out">How it was measured</Link>
            </p>
          </div>
        </div>

        {show ? (
          <HomeStage head={show.head} exhibits={show.exhibits} brief={show.brief} filedAt={show.filed} ruling={show.ruling} />
        ) : (
          <div className={`sheet ${styles.noShow}`}>
            <p>No case has been argued on this desk yet.</p>
            <Link className="btn btnPrimary" href="/new">
              Open the first one
            </Link>
          </div>
        )}

        {stats && (
          <dl className={styles.stats}>
            <div>
              <dt>Altered sentences struck</dt>
              <dd>
                {proof.summary.mutationsStruck.toLocaleString("en-US")} <small>of {proof.summary.mutations.toLocaleString("en-US")}</small>
              </dd>
              <p>
                true sentences with one fact changed, in the eval; plain code, re-run with <Link href="/proof#checker">no model</Link>
              </p>
            </div>
            <div>
              <dt>Struck before filing</dt>
              <dd>{stats.struck}</dd>
              <p>
                of {stats.sentences} sentences on the live desk, by the checker{stats.withdrawn ? `; ${stats.withdrawn} more withdrawn at hearings` : ""}
              </p>
            </div>
            <div>
              <dt>Answered through PayPal</dt>
              <dd>{stats.filed + stats.refunded}</dd>
              <p>
                {stats.filed} filed, {stats.refunded} refunded
              </p>
            </div>
            <div>
              <dt>Ruled at Exhibit&apos;s request</dt>
              <dd>{stats.wonAsked + stats.lostAsked}</dd>
              <p>
                {stats.wonAsked} for the seller, {stats.lostAsked} for the buyer: PayPal&apos;s sandbox ruled the side Exhibit asked for
                {stats.askedBuyer + stats.askedSeller > 0
                  ? `. Asked and not yet given: ${stats.askedBuyer + stats.askedSeller}${
                      stats.askedUnauthorised ? `, ${stats.askedUnauthorised} of them unauthorised-transaction chargebacks, which the sandbox hasn't ruled on` : ""
                    }`
                  : ""}
              </p>
            </div>
            <div>
              <dt>Closed by the sandbox on its own</dt>
              <dd>{stats.wonByItself + stats.lostByItself}</dd>
              <p>
                {stats.wonByItself} won, {stats.lostByItself} lost, with no ruling asked; these say nothing about the filing
              </p>
            </div>
            <div>
              <dt>Still at stake</dt>
              <dd>{usd(stats.atStake)}</dd>
              <p>waiting on the seller or PayPal</p>
            </div>
          </dl>
        )}
        {stats && (
          <p className={styles.asOf}>
            Counted from PayPal&apos;s dispute list at <time dateTime={stats.at}>{utcStamp(stats.at)}</time>, the same snapshot{" "}
            <Link href="/desk">the desk</Link> shows: {stats.cases} shop cases, {stats.argued} of them argued by Exhibit.
          </p>
        )}
      </section>

      <SectionIndex items={index} />

      <section className={`shell ${styles.section} ${styles.split}`} id="checker">
        <div>
          <h2>No claim without a record</h2>
          <p>
            A response that gets one date wrong hands the case to the buyer. So Exhibit never takes the model&apos;s word for a fact. Every amount,
            date, time, id, ZIP, carrier and signer in a sentence has to appear in the record that sentence cites, one clause to one record, or the
            sentence is struck before filing. A sentence with nothing to match is marked unverified.
          </p>
          <p>The model argues. The records decide what it&apos;s allowed to say.</p>
        </div>
        <Pleading lines={11}>
          {show?.strikeDemo ? (
            <figure className={styles.strike}>
              <p className={`serif ${styles.kept}`}>
                {show.strikeDemo.original.text}
                {show.strikeDemo.original.cites.map((c) => (
                  <span key={c} className={styles.cite}>
                    {c}
                  </span>
                ))}
              </p>
              <p className={`serif ${styles.struck}`}>{show.strikeDemo.altered.text}</p>
              <figcaption>
                {show.strikeDemo.altered.kept
                  ? "The checker passed this one too."
                  : `Struck: ${show.strikeDemo.altered.why} We moved one date in the sentence above by a few days and ran the same checker the filing uses.`}
              </figcaption>
            </figure>
          ) : (
            <figure className={styles.strike}>
              <p className={`serif ${styles.struck}`}>USPS delivered it on 29 Sep 2026, signed for at the front desk.</p>
              <figcaption>Struck when no cited exhibit contains 29 Sep 2026.</figcaption>
            </figure>
          )}
        </Pleading>
      </section>

      {show && (
        <section className={`shell ${styles.section}`} id="exhibits">
          <div className={styles.lede}>
            <h2>Every record becomes an exhibit</h2>
            <p>
              The case on the desk, as a PayPal reviewer would get it: {show.exhibits.length} lettered records. The yellow tab is the buyer&apos;s claim.
              What comes from PayPal is quoted as the API returned it, with its id; what comes from the store says so.
            </p>
          </div>
          <ExhibitWall exhibits={show.exhibits} />
        </section>
      )}

      <section id="how" className={`shell ${styles.section}`}>
        <h2>How a case moves</h2>
        <ol className={styles.steps}>
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className={styles.stepNo}>{i + 1}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
              <p className={styles.api}>{s.api}</p>
            </li>
          ))}
        </ol>
      </section>

      {show && (
        <section className={`shell ${styles.section} ${styles.split}`} id="filing">
          <div>
            <h2>What reaches PayPal</h2>
            <p>
              One multipart call to <span className={styles.code}>provide-evidence</span>: the response as notes, the tracking or refund details, and a PDF
              with the response on page one and every exhibit on its own page, each Bates-stamped HC-000001 onwards, the way exhibits are marked in a
              filing.
            </p>
            <p>When the call is to refund, it&apos;s <span className={styles.code}>accept-claim</span> instead, and PayPal refunds the buyer.</p>
            <p className={styles.readPdf}>
              <a className="btn btnQuiet" href={`/api/cases/${show.head.id}/pdf`} target="_blank" rel="noreferrer">
                Read the PDF for {show.head.id}
              </a>
            </p>
          </div>
          <PdfSpread head={show.head} brief={show.brief} exhibits={show.exhibits} />
        </section>
      )}

      {live.hearing && (
        <section className={`shell ${styles.section} ${styles.split}`} id="cross-examination">
          <div>
            <h2>Cross-examined before PayPal reads it</h2>
            <p>
              A second model plays PayPal&apos;s reviewer. It reads only the Bates-stamped PDF, and its objections come from what the card network asks
              for on the reason code: delivery to the transaction&apos;s address, a 3-D Secure result, a credit on the duplicate. Exhibit answers from the
              exhibits. An answer counts only if the same checker that guards the brief keeps every figure in it: kept, the objection is{" "}
              <strong>overruled</strong>; struck or conceded, it is <strong>sustained</strong> and the sentence is withdrawn.
            </p>
            <p>
              Measured on {reviewProof.summary.hearings} labelled cases: the reviewer raised {reviewProof.summary.reviewerObjections} objections on{" "}
              {reviewProof.summary.fightsWithReviewerObjections} of {reviewProof.summary.fights} fights, and the requirements card added{" "}
              {reviewProof.summary.objections - reviewProof.summary.reviewerObjections} more in code; {reviewProof.summary.overruled} were overruled,{" "}
              {reviewProof.summary.sustained} sustained ({reviewProof.summary.conceded} conceded). The reviewer reached the labelled call in{" "}
              {reviewProof.summary.reviewerMatchesLabel} of {reviewProof.summary.hearings}. Its verdict is the ruling Exhibit asks the sandbox for.
            </p>
            <p className={styles.readPdf}>
              <Link className="btn btnQuiet" href={`/case/${live.hearing.caseId}`}>
                Take the reviewer&apos;s chair on {live.hearing.caseId}
              </Link>
            </p>
          </div>
          <div className={`sheet ${styles.transcript}`}>
            <p className={styles.mandateHead}>
              <span className="bates">{live.hearing.caseId}</span>
              <span>
                {live.hearing.source === "paypal" ? "On the PDF PayPal holds" : "On the draft, before filing"}, {utcStamp(live.hearing.at)}
              </span>
            </p>
            {live.hearing.exchanges.map((e, i) => (
              <Exchange key={i} index={i} objection={e.objection} answer={e.answer} ruling={e.ruling} reason={e.reason} pressed={live.hearing!.pressed?.[i] ?? null} />
            ))}
            <p className={styles.transcriptVerdict}>
              <strong>Verdict for the {live.hearing.verdict.side}:</strong> {live.hearing.verdict.reason}.
              {live.hearing.outcome ? ` ${live.hearing.outcome}.` : ""}
            </p>
          </div>
        </section>
      )}

      {(live.lane || live.agent) && (
        <section className={`shell ${styles.section} ${styles.split}`} id="zero-touch">
          <div>
            <h2>Zero-touch, from PayPal&apos;s webhook to the ruling</h2>
            <p>
              PayPal announces every chargeback with a signed webhook, checked with verify-webhook-signature before anything runs, and the autopilot
              argues the case at once. On the seller&apos;s own lane it then transacts under written house rules: it reads the case through PayPal&apos;s
              Agent Toolkit, holds a hearing on the draft, files or refunds after a ten-minute undo window, and asks for the ruling when PayPal opens the
              case for one. Every step is a line on the case.
            </p>
            {live.lane && (
              <ol className={styles.trail}>
                {live.lane.audit.map((a, i) => (
                  <li key={i}>
                    <time dateTime={a.at}>{utcStamp(a.at)}</time>
                    <span>{a.text}</span>
                  </li>
                ))}
              </ol>
            )}
            {live.lane && (
              <p className={styles.readPdf}>
                <Link className="btn btnQuiet" href={`/case/${live.lane.caseId}`}>
                  Open {live.lane.caseId}
                </Link>
              </p>
            )}
          </div>
          {live.agent && (
            <div className={`sheet ${styles.mandate}`}>
              <p className={styles.mandateHead}>
                <span className="bates">{live.agent.caseId}</span>
                <span>Live buyer agent{live.agent.model ? `, ${live.agent.model}` : ""}</span>
              </p>
              <p className={styles.mandateNote}>
                {live.agent.cardholder ? `${live.agent.cardholder}'s` : "The cardholder's"} shopping agent made this purchase with tools, under an intent
                signed with published key <span className="bates">{live.agent.intentKid}</span>. It signed the cart with{" "}
                <span className="bates">{live.agent.cartKid}</span>, and the PayPal order{live.agent.orderId ? ` ${live.agent.orderId}` : ""} carries
                ap2:{live.agent.digest.slice(0, 12)}… in custom_id.
              </p>
              <ol className={styles.toolTrail}>
                {live.agent.steps.map((s) => (
                  <li key={s.n} data-ok={s.ok}>
                    <strong>
                      <code>{s.tool}</code>
                    </strong>
                    <span>{s.why ?? s.result}</span>
                  </li>
                ))}
              </ol>
              <ol>
                {live.agent.checks.map((c) => (
                  <li key={c.label} data-ok={c.ok}>
                    <strong>{c.ok ? "Pass" : "Fail"}</strong>
                    <span>{c.label}</span>
                  </li>
                ))}
              </ol>
              {live.agent.verdict && <p className={styles.mandateNote}>{live.agent.verdict}</p>}
            </div>
          )}
        </section>
      )}

      <section className={`shell ${styles.section}`} id="platform">
        <div className={styles.lede}>
          <h2>Built on the PayPal platform</h2>
          <p>
            Every call, all in the free sandbox with test money. A case is opened, read, argued, filed and ruled on without anyone touching the PayPal
            website, and its state is read back from PayPal&apos;s own record.
          </p>
        </div>
        <Docket />
      </section>

      <section className={`shell ${styles.section} ${styles.split}`} id="refund">
        <div>
          <h2>It tells you when to give up</h2>
          <p>
            PayPal charges its {usd(DISPUTE_FEE.card)} chargeback fee whether you fight or refund, so the fee isn&apos;t what a losing fight costs. The
            cost is the time it takes to answer by the response date, and then the sale goes back to the buyer anyway. When the records point the other
            way (no tracking, a likely stolen card), Exhibit says so, shows the tally that decided it, and accepts the claim for you with one confirmed
            click.
          </p>
        </div>
        <ul className={styles.calls}>
          <li>
            <strong>Delivered and signed for</strong>
            <span>Fight it</span>
          </li>
          <li>
            <strong>Charged twice, second charge refunded</strong>
            <span>Fight it</span>
          </li>
          <li>
            <strong>Shipped without tracking</strong>
            <span data-rec="accept">Refund it</span>
          </li>
          <li>
            <strong>First order, shipped to a parcel forwarder</strong>
            <span data-rec="accept">Refund it</span>
          </li>
          <li>
            <strong>Bought by their own shopping agent, inside the mandate they signed</strong>
            <span>Fight it if network evidence backs it</span>
          </li>
          <li>
            <strong>Their agent spent past the limit they signed</strong>
            <span data-rec="accept">Refund it</span>
          </li>
        </ul>
      </section>

      <section className={`shell ${styles.section} ${styles.split}`} id="agents">
        <div>
          <h2>When the buyer&apos;s AI agent did the buying</h2>
          <p>
            Shopping agents now pay with their owner&apos;s card. When the owner later says &ldquo;I never authorised this&rdquo;, the question is what
            they signed. Exhibit reads the cardholder&apos;s signed intent (what the agent may buy, up to what total, shipped where, until when), the
            agent&apos;s signed cart, and the SHA-256 of that cart the PayPal order carries, then checks all of it in code before the model writes a word.
            Signatures are checked against the demo keys Exhibit publishes (it holds the stand-in wallet and agent-platform keys), never a key the
            mandate brings along.
          </p>
          <p>
            The mandate decides who is responsible: inside it, the cardholder; past the limit, or with a signature that doesn&apos;t verify, the agent
            platform, and Exhibit refunds. Responsibility isn&apos;t the same as winning: card networks don&apos;t yet treat a signed mandate as
            authorisation evidence, so Exhibit fights only when network-recognised evidence backs it, such as earlier undisputed orders from the same
            device and IP address (compelling evidence) or a 3-D Secure result. Without it, as on PP-R-UPI-10195190, it advises a refund. A buyer agent
            with shopping tools makes every purchase, and in one story a line planted in the listing pushes it toward the wrong cart.
          </p>
          <p>
            The seller can have an agent too. Exhibit is an MCP server at <span className={styles.code}>/api/mcp</span>: any assistant that speaks
            the Model Context Protocol can list the cases, read one, have Exhibit argue it, and file the response or the refund, through the same
            checks and PayPal&apos;s own links.
          </p>
        </div>
        <div className={`sheet ${styles.mandate}`}>
          <p className={styles.mandateHead}>
            <span className="bates">Sample mandate check</span>
            <span>{sample.length} checks, run by code</span>
          </p>
          <p className={styles.mandateNote}>
            A sample cart signed with throwaway keys and checked against a sample order, by the same code a case runs. Open the shopping-agent story
            to see a real purchase, its PayPal order and the agent&apos;s tool calls.
          </p>
          <ol>
            {sample.map((c) => (
              <li key={c.label} data-ok={c.ok}>
                <strong>{c.ok ? "Pass" : "Fail"}</strong>
                <span>
                  {c.label}
                  <small>{c.detail}</small>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className={`shell ${styles.section}`} id="measured">
        <div className={styles.lede}>
          <h2>Measured, not promised</h2>
          <p>
            {proof.summary.variants} labelled variants of the seven stories, each run with two customers, against a rules baseline that reads every
            record. Then a careless drafter told to use facts no record holds, and one thing changed in every true sentence. All of it is on the proof
            page, with what it doesn&apos;t show.
          </p>
        </div>
        <dl className={styles.measured}>
          <div>
            <dt>Deciding fact only in free text</dt>
            <dd>
              {proof.summary.modelCorrectOnText} vs {proof.summary.strongCorrectOnText}
            </dd>
            <p>
              the model vs the stronger rules, of {proof.summary.textRuns} runs; on the other {proof.summary.recordRuns} both get{" "}
              {Math.min(proof.summary.modelCorrectOnRecord, proof.summary.strongCorrectOnRecord)} or more
            </p>
          </div>
          <div>
            <dt>Invented facts struck</dt>
            <dd>
              {proof.summary.carelessPlantedStruck}/{proof.summary.carelessPlantedSentences}
            </dd>
            <p>Exhibit&apos;s own prompt wrote none of them</p>
          </div>
          <div>
            <dt>False statements struck</dt>
            <dd>
              {proof.summary.mutationsStruck}/{proof.summary.mutations}
            </dd>
            <p>figures, names, places, recombined records and denials</p>
          </div>
          <div>
            <dt>Per brief</dt>
            <dd>{((proof.summary.medianMs ?? 0) / 1000).toFixed(1)} s</dd>
            <p>median, about {Math.round(((proof.summary.medianInputTokens ?? 0) + (proof.summary.medianOutputTokens ?? 0)) / 100) / 10}k tokens</p>
          </div>
        </dl>
        <p className={styles.readPdf}>
          <Link className="btn btnQuiet" href="/proof">
            Read the proof
          </Link>
        </p>
      </section>

      <section className={`shell ${styles.section}`} id="cost">
        <div className={styles.lede}>
          <h2>What a dispute costs a small seller</h2>
          <p>
            The fee, the response date and the hour of paperwork land on shops with no one to hand them to. Chargeback services take a quarter of every
            case they win; the Resolution Center is free if you write it yourself. Exhibit is for the seller in between.
          </p>
        </div>
        <ul className={styles.figures}>
          {FIGURES.map((f) => (
            <li key={f.value} className="sheet">
              <strong>{f.value}</strong>
              <p>{f.what}</p>
              <a href={f.href} target="_blank" rel="noreferrer">
                {f.source}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className={`shell ${styles.section} ${styles.split} ${styles.phoneSec}`} id="phone">
        <div>
          <h2>Made for the phone in your apron pocket</h2>
          <p>
            Most sellers read a dispute notice on their phone. The brief reads the same there: tap an exhibit letter and the record opens in place under
            the sentence that cites it; the desk becomes a list of cards.
          </p>
        </div>
        <div className={styles.phoneFrame}>
          <Image src="/phone-case.png" alt="A case on a phone: the response with exhibit marks, and Exhibit E opened under its sentence" width={585} height={1266} />
        </div>
      </section>

      <section className={`shell ${styles.section} ${styles.final}`} id="try">
        <h2>Try it as the seller</h2>
        <p>
          Open a case and Exhibit takes a real sandbox card payment, ships it, and has the card issuer file a chargeback through PayPal. Then it&apos;s on
          your desk.
        </p>
        <Link className="btn btnPrimary" href="/new">
          Open a sandbox case
        </Link>
      </section>
    </main>
  );
}
