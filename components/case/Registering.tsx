"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** A case Exhibit just opened that PayPal hasn't listed yet. Checks again every five seconds. */
export default function Registering({ id }: { id: string }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [router]);
  return (
    <main className="shell" style={{ paddingTop: 60, maxWidth: 720 }}>
      <p className="bates">{id}</p>
      <h1 style={{ fontSize: 34, marginTop: 10 }}>PayPal is registering this case</h1>
      <p style={{ marginTop: 14, color: "var(--ink-soft)" }} role="status">
        The chargeback was opened a moment ago and PayPal takes a few seconds to list it. This page checks again every five seconds.
      </p>
    </main>
  );
}
