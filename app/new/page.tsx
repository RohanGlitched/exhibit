import type { Metadata } from "next";
import OpenCase from "@/components/OpenCase";
import { SCENARIOS } from "@/lib/shop/scenarios";
import { reasonLabel, usd } from "@/lib/format";
import styles from "./new.module.css";

export const metadata: Metadata = { title: "Open a sandbox case" };

export default function NewCase() {
  const cases = SCENARIOS.map((s) => {
    const total = s.items.reduce((t, i) => t + Number(i.price) * i.quantity, 0) + Number(s.shipping);
    return { id: s.id, title: s.title, blurb: s.blurb, reason: reasonLabel(s.reason), amount: usd(total), buyer: s.buyer.name };
  });
  return (
    <main className={`shell ${styles.page}`}>
      <header className={styles.head}>
        <h1>Open a dispute against the shop</h1>
        <p>
          Pick a story. Exhibit takes a real sandbox card payment to Halden Ceramics, adds the tracking number, then has the card issuer file a
          chargeback through PayPal&apos;s sandbox. You get the case on your desk, as the seller, to argue and file.
        </p>
      </header>
      <OpenCase cases={cases} />
      <p className={styles.note}>
        Some of these the seller should win and some it should refund. Exhibit doesn&apos;t know which story you picked; it only sees the records.
      </p>
    </main>
  );
}
