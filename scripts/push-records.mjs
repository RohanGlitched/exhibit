// Copies local case records (.data/cases) into the Blob store so production knows their stories.
import { readFileSync, readdirSync } from "node:fs";
import { put } from "@vercel/blob";
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/); if (m) process.env[m[1]] = m[2]; }
for (const f of readdirSync(".data/cases")) {
  const body = readFileSync(`.data/cases/${f}`, "utf8");
  await put(`cases/${f}`, body, { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });
  console.log("put", f);
}
