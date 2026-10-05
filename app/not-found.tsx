import Link from "next/link";

export default function NotFound() {
  return (
    <main className="shell" style={{ paddingTop: 60, maxWidth: 720 }}>
      <p className="bates">NOT ON FILE</p>
      <h1 style={{ fontSize: 34, marginTop: 10 }}>There&apos;s no page here</h1>
      <p style={{ marginTop: 14, color: "var(--ink-soft)" }}>
        The desk, the open-a-case page and every case have their own addresses. This isn&apos;t one of them.
      </p>
      <p style={{ marginTop: 22, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link className="btn btnPrimary" href="/desk">
          Go to the desk
        </Link>
        <Link className="btn btnQuiet" href="/">
          Home
        </Link>
      </p>
    </main>
  );
}
