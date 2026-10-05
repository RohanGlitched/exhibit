// Usage: npx tsx --conditions=react-server scripts/try-case.ts open <scenario> | argue <disputeId> [model]
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
const [cmd, arg, mode] = process.argv.slice(2);
const { openCase } = await import("../lib/cases/open.ts");
const { caseContext } = await import("../lib/cases/service.ts");
const { argueWithRules, argueWithModel } = await import("../lib/cases/brief.ts");
const { scenario } = await import("../lib/shop/scenarios.ts");
if (cmd === "open") {
  const rec = await openCase(scenario(arg)!);
  console.log(JSON.stringify(rec, null, 1));
} else {
  const ctx = await caseContext(arg);
  for (const e of ctx.exhibits) console.log(`[${e.id}] ${e.title} — ${e.source}\n   ${e.facts.map((f) => `${f.label}: ${f.value}`).join(" | ")}\n   ${(e.lines ?? []).join("\n   ")}`);
  const b = mode === "model" ? await argueWithModel(ctx.dispute, ctx.exhibits) : argueWithRules(ctx.dispute, ctx.exhibits);
  console.log("\n", b.recommendation, b.odds + "%", b.headline, `(${b.engine}, ${b.ms} ms)`);
  for (const s of b.sentences) console.log(s.kept ? "  ✓" : "  ✗", s.text, s.cites.join(","), s.why ?? "");
  for (const t of b.tally) console.log("  ", t.side, t.weight, t.point, t.cites.join(","));
  console.log("evidence:", b.evidenceTypes.join(", "));
}
