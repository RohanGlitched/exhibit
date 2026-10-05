import Image from "next/image";
import Link from "next/link";
import HomeStage from "@/components/hero/HomeStage";
import Docket from "@/components/home/Docket";
import ExhibitWall from "@/components/home/ExhibitWall";
import PdfSpread from "@/components/home/PdfSpread";
import Pleading from "@/components/home/Pleading";
import { deskStats, showcase } from "@/lib/showcase";
import { usd } from "@/lib/format";
import styles from "./home.module.css";

export const revalidate = 300;

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
    api: "Azure OpenAI Responses API, one forced function call",
  },
  {
    title: "Check every sentence",
    text: "Before anything is filed, each amount, date, time and id in the response is matched against the exhibits it cites. Anything unmatched is struck, and you see why.",
    api: "Runs on Exhibit's server, no model involved",
  },
  {
    title: "File it with PayPal",
    text: "You approve with one click. Exhibit files the evidence with tracking details and a Bates-stamped PDF, or accepts the claim and refunds, through the Disputes API.",
    api: "POST /provide-evidence or /accept-claim",
  },
];

export default async function Home() {
  const [show, stats] = await Promise.all([showcase().catch(() => null), deskStats().catch(() => null)]);
  return (
    <main>
      <section className={`shell ${styles.hero}`}>
        <div className={styles.heroText}>
          <h1>
            Win the disputes you should{" "}
            <span className={styles.nowrap}>
              win.<span className={styles.sticker} data-side="respondent">A</span>
            </span>{" "}
            Refund the ones you&apos;d{" "}
            <span className={styles.nowrap}>
              lose.<span className={styles.sticker} data-side="claimant">B</span>
            </span>
          </h1>
          <div className={styles.heroSide}>
            <p>
              Exhibit is the dispute desk for small PayPal sellers. It reads each dispute, pulls the order, payment and tracking behind it, and writes
              the response with every sentence pinned to the record that proves it.
            </p>
            <div className={styles.ctas}>
              <Link className="btn btnPrimary" href="/new">
                Open a sandbox case
              </Link>
              <Link className="btn btnQuiet" href="/desk">
                See the desk
              </Link>
            </div>
          </div>
        </div>

        {show ? (
          <HomeStage head={show.head} exhibits={show.exhibits} brief={show.brief} filedAt={show.filed} />
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
              <dt>Cases argued</dt>
              <dd>{stats.argued}</dd>
            </div>
            <div>
              <dt>Sentences checked</dt>
              <dd>{stats.sentences}</dd>
            </div>
            <div>
              <dt>Struck before filing</dt>
              <dd>{stats.struck}</dd>
            </div>
            <div>
              <dt>Filed with PayPal</dt>
              <dd>{stats.filed}</dd>
            </div>
            <div>
              <dt>On the desk now</dt>
              <dd>{usd(stats.atStake)}</dd>
            </div>
          </dl>
        )}
      </section>

      <section className={`shell ${styles.section} ${styles.split}`}>
        <div>
          <h2>No claim without a record</h2>
          <p>
            A response that gets one date wrong hands the case to the buyer. So Exhibit never takes the model&apos;s word for a fact. Every amount, date,
            time, tracking number and id in a sentence has to appear in the exhibits that sentence cites, or the sentence is struck before filing.
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
        <section className={`shell ${styles.section}`}>
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
        <section className={`shell ${styles.section} ${styles.split}`}>
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

      <section className={`shell ${styles.section}`}>
        <div className={styles.lede}>
          <h2>Built on the PayPal platform</h2>
          <p>
            Twelve calls, all in the free sandbox with test money. A case is opened, read, argued, filed and ruled on without anyone touching the
            PayPal website.
          </p>
        </div>
        <Docket />
      </section>

      <section className={`shell ${styles.section} ${styles.split}`}>
        <div>
          <h2>It tells you when to give up</h2>
          <p>
            Fighting a case you&apos;ll lose costs a dispute fee and a customer. When the records point the other way (no tracking, a likely stolen card),
            Exhibit says so, shows the tally that decided it, and accepts the claim for you with one confirmed click.
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
        </ul>
      </section>

      <section className={`shell ${styles.section} ${styles.split} ${styles.phoneSec}`}>
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

      <section className={`shell ${styles.section} ${styles.final}`}>
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
