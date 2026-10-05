import type { Brief, Exhibit } from "@/lib/cases/types";
import { SHOP } from "@/lib/shop/catalog";
import { day } from "@/lib/format";
import styles from "./home-art.module.css";

interface Props {
  head: { id: string; reason: string; amount: string; order: string | null };
  brief: Brief;
  exhibits: Exhibit[];
}

const bates = (n: number) => `HC-${String(n).padStart(6, "0")}`;

/** Three pages of the PDF Exhibit files with PayPal, fanned on the desk: the response, then two exhibits. */
export default function PdfSpread({ head, brief, exhibits }: Props) {
  const kept = brief.sentences.filter((s) => s.kept);
  const pick = [exhibits.find((e) => e.kind === "claim"), exhibits.find((e) => e.kind === "scans") ?? exhibits[1]].filter((e): e is Exhibit => Boolean(e));
  return (
    <div className={styles.spread} role="img" aria-label={`Three pages of the response filed for case ${head.id}: the response letter, then exhibits ${pick.map((e) => e.id).join(" and ")}, each Bates-stamped`}>
      <div className={`${styles.pageMini} ${styles.pageOne}`}>
        <p className={styles.miniHead}>
          <strong>{SHOP.name}</strong>
          <span>
            {SHOP.returnAddress.address_line_1}, {SHOP.returnAddress.admin_area_2}, {SHOP.returnAddress.admin_area_1}
          </span>
        </p>
        <p className={styles.miniTitle}>Response to PayPal case {head.id}</p>
        <p className={styles.miniMeta}>
          {head.reason} · {head.amount} disputed{head.order ? ` · store order ${head.order}` : ""} · {day(brief.createdAt)}
        </p>
        <div className={styles.miniBody}>
          {kept.map((s, i) => (
            <p key={i}>
              {s.text} <em>[{s.cites.join(", ")}]</em>
            </p>
          ))}
        </div>
        <p className={styles.miniList}>
          <strong>Exhibits</strong>
          {exhibits.map((e) => (
            <span key={e.id}>
              {e.id} {e.title}
            </span>
          ))}
        </p>
        <span className={styles.miniBates}>{bates(1)}</span>
      </div>
      {pick.map((e, i) => (
        <div key={e.id} className={`${styles.pageMini} ${i === 0 ? styles.pageTwo : styles.pageThree}`}>
          <span className={styles.miniTab} data-side={e.kind === "claim" ? "claimant" : "respondent"}>
            Exhibit {e.id}
          </span>
          <p className={styles.miniTitle}>{e.title}</p>
          <p className={styles.miniMeta}>{e.source}</p>
          <dl className={styles.miniFacts}>
            {e.facts.slice(0, 6).map((f) => (
              <div key={f.label}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
          {e.lines && e.lines.length > 0 && (
            <div className={styles.miniLines}>
              {e.lines.slice(0, 5).map((l, j) => (
                <p key={j}>{l}</p>
              ))}
            </div>
          )}
          <span className={styles.miniBates}>{bates(exhibits.indexOf(e) + 2)}</span>
        </div>
      ))}
    </div>
  );
}
