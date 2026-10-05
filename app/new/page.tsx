import type { Metadata } from "next";
import OpenCase from "@/components/OpenCase";
import { SCENARIOS } from "@/lib/shop/scenarios";
import { reasonLabel, usd } from "@/lib/format";
import styles from "./new.module.css";

export const metadata: Metadata = { title: "Open a sandbox case" };

export default function NewCase() {
  const cases = SCENARIOS.map((s) => {
    const total = s.items.reduce((t, i) => t + Number(i.price) * i.quantity, 0) + Number(s.shipping);
    return {
      id: s.id,
      title: s.title,
      blurb: s.blurb,
      reason: reasonLabel(s.reason),
      amount: usd(total),
      buyer: s.buyer.name,
      network: s.cardBrand === "VISA" ? "Visa" : s.cardBrand === "MASTERCARD" ? "Mastercard" : "Amex",
      code: s.reasonCode,
    };
  });
  return (
    <main className={`shell ${styles.page}`}>
      <header className={styles.head}>
        <div>
          <h1>Open a dispute against the shop</h1>
          <p>
            Pick a story. Exhibit takes a real sandbox card payment to Halden Ceramics, adds the tracking number, then has the card issuer file a
            chargeback through PayPal&apos;s sandbox. You get the case on your desk, as the seller, to argue and file.
          </p>
        </div>
        <ol className={`sheet ${styles.what}`} aria-label="What happens when you open a case">
          <li>
            <span>1</span>
            <div>
              <strong>The buyer pays the shop</strong> with one of PayPal&apos;s test cards. <em>POST /v2/checkout/orders</em>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>The shop ships it</strong> and adds the tracking number. <em>POST /v2/checkout/orders/{"{id}"}/track</em>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>The card issuer files a chargeback.</strong> PayPal reviews it for five to eight minutes; you get one that is already with the
              seller. <em>POST /v2/customer-support/process-chargeback</em>
            </div>
          </li>
        </ol>
      </header>
      <OpenCase cases={cases} />
      <p className={styles.note}>
        Some of these the seller should win and some it should refund. Exhibit doesn&apos;t know which story you picked; it only sees the records.
      </p>
    </main>
  );
}
