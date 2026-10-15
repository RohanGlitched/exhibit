// Usage: npx tsx --conditions=react-server scripts/view-case.ts <disputeId>... Prints what the case page would show.
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
delete process.env.BLOB_READ_WRITE_TOKEN; // read-only check: never touch the shared store from a laptop
const { caseView } = await import("../lib/cases/view.ts");
for (const id of process.argv.slice(2)) {
  const v = await caseView(id, null);
  console.log(`\n== ${id} ${v.status} -> ${v.where}: ${v.whereLine}${v.restored ? " (restored)" : ""}`);
  console.log(`   story: ${v.story?.title ?? "-"} | buyer: ${v.story?.buyer ?? "-"} | order ${v.invoiceId} | pdf on file: ${Boolean(v.filedPdf)} | ruled ${v.ruledAt ?? "-"}`);
  for (const f of v.filings) console.log(`   filed ${f.at} ${f.action} ${f.source ?? "exhibit"}: ${f.summary}`);
  console.log(`   exhibits: ${v.exhibits.map((e) => `${e.id}:${e.kind}`).join(" ")}`);
  if (v.brief) {
    console.log(`   brief (${v.brief.engine}) ${v.brief.recommendation} ${v.brief.odds}%: ${v.brief.headline}`);
    for (const s of v.brief.sentences) console.log(`     ${s.kept ? "+" : "x"} [${s.cites.join(",")}] ${s.text.slice(0, 110)}${s.why ? `  <- ${s.why}` : ""}`);
  }
}
