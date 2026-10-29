import type { Metadata } from "next";
import Link from "next/link";
import { SAVED_RECORDED, SAVED_THREAD } from "@/components/studio/saved";
import StudioLoader from "@/components/studio/StudioLoader";
import { day } from "@/lib/format";
import styles from "../desk.module.css";
import made from "./analytics.module.css";

export const metadata: Metadata = {
  title: "Analytics",
  description: "The dispute desk in AG Studio: deadlines, money kept and refunded, and what Exhibit's checker struck, with an analyst you can ask.",
};

const NOTES = [
  {
    mark: "A",
    title: "Exhibit's own widgets",
    body: (
      <>
        Four custom AG Studio widgets drawn in React and SVG: the <b>deadline ladder</b>, the <b>kept, refunded and lost ledger</b>, the checker&apos;s{" "}
        <b>pleading paper</b> and the <b>rubber stamps</b>. They read their rows through Studio, so page filters and cross-filters apply to them; each has its
        own form in Studio&apos;s edit panel and a description Studio&apos;s agents read. Grid cells print case ids as Bates numbers that open the case on a
        double-click.
      </>
    ),
  },
  {
    mark: "B",
    title: "An analyst on Studio's agent framework",
    body: (
      <>
        Exhibit analyst is a custom agent on Studio&apos;s Agent Framework. It knows PayPal&apos;s response dates, fight or refund, and the checker, and has five
        tools of its own: <code>deadline_ladder</code>, <code>desk_ledger</code>, <code>turn_to_page</code>, <code>new_widget_slot</code> and{" "}
        <code>check_widget</code>. It hands anything that changes the dashboard to Studio&apos;s own planning, page and widget agents, then reads the report back
        so it only reports what changed. Every turn runs on the app&apos;s own model (GPT-5.6 on Azure OpenAI) through this server, which writes the analyst&apos;s
        instructions itself; no key reaches the browser.
      </>
    ),
  },
  {
    mark: "C",
    title: "Paperwork, not a template",
    body: (
      <>
        Studio&apos;s theme sets the blue backing sheet, white widgets ruled in hairlines, the site&apos;s type, and a chart palette in Exhibit&apos;s inks: blue
        for money at stake, red for lost or struck, green only for a win, plain ink for a refund. Grid widgets print case ids as red Bates numbers, and the
        pages are binder tabs.
      </>
    ),
  },
  {
    mark: "D",
    title: "Straight from the desk",
    body: (
      <>
        Two tables from <code>/api/analytics</code>: one row per dispute on the sandbox account, read from PayPal&apos;s Disputes API, and one per sentence
        Exhibit wrote and checked, joined on the case id. The page reads them again every minute.
      </>
    ),
  },
];

// Static, re-rendered every ten minutes so the docket date stays current; the data itself loads in the browser.
export const revalidate = 600;

export default function Analytics() {
  return (
    <main className={`shell ${styles.page}`}>
      <header className={styles.head}>
        <div>
          <p className={styles.docketLine}>
            <span className="bates">Analytics</span>
            <span>{day(new Date())}</span>
            <span>Halden Ceramics, sandbox account</span>
          </p>
          <h1>The desk, by the numbers</h1>
          <p className={styles.lede}>
            Live data from the desk: every dispute on the shop&apos;s PayPal sandbox account, where it stands with PayPal, and the brief Exhibit wrote for it.
            See what is due before each case&apos;s response date, what fighting kept against what refunds gave back, and which sentences the checker struck.
            Click a rung, a stamp or a bar to filter the page, or ask the analyst.
          </p>
        </div>
        <div className={styles.headLinks}>
          <Link className="btn btnQuiet" href="/desk">
            Back to the desk
          </Link>
        </div>
      </header>
      <StudioLoader />
      <section className={made.made} aria-labelledby="made">
        <h2 id="made">How the report is made</h2>
        <p className={made.madeLede}>
          The report runs on AG Studio, embedded in Exhibit. Switch to <b>Edit with the analyst</b> to move widgets, change what they show, add Exhibit&apos;s
          own from the widget menu, or ask for one in words.
          {SAVED_THREAD
            ? ` The analyst opens on a conversation recorded on ${SAVED_RECORDED}, saved as it ran: asked for a chart of disputed money by who decided, it built the "Disputed money by who decided" chart at the foot of the Money page. Opening it replays the record; it calls no model. Two things on that chart were set after recording: a legend, and its colours. As recorded, its kept, refunded and lost series came out blue, red and green; the page puts them in the palette's order, with the money still at stake added in front, so lost is red, kept green and refunded plain ink.`
            : ""}
        </p>
        <ol className={made.notes}>
          {NOTES.map((n) => (
            <li key={n.mark} className={`sheet ${made.note}`}>
              <span className={made.sticker} aria-hidden="true">
                {n.mark}
              </span>
              <h3>{n.title}</h3>
              <p>{n.body}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
