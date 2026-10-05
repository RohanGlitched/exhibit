// End to end on a deployed or local build: home, desk, open a case, watch it argued, check the PDF.
// Usage: node scripts/e2e.cjs <base> [scenario]
const { chromium } = require("I:/Programs/ListofHackathon/hackathons/01-arbitrum-open-house/submission/video/node_modules/playwright");
const base = process.argv[2] || "http://localhost:3600";
const scenario = process.argv[3] || "colour";
(async () => {
  const browser = await chromium.launch({ args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] });
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport: vp });
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    const t0 = Date.now();
    await page.goto(base + "/", { waitUntil: "load" });
    await page.getByRole("heading", { level: 1 }).waitFor();
    await page.goto(base + "/desk", { waitUntil: "load" });
    await page.getByRole("heading", { name: "The desk" }).waitFor();
    if (vp.width > 800) {
      await page.goto(base + "/new", { waitUntil: "load" });
      const card = page.locator("li", { hasText: scenario === "colour" ? "glaze colour" : "never arrived" }).first();
      await card.getByRole("button", { name: "Open this case" }).click();
      await page.waitForURL(/\/case\/PP-/, { timeout: 60000 });
      console.log(vp.width, "opened", page.url().split("/case/")[1], `${((Date.now() - t0) / 1000).toFixed(1)}s`);
      await page.getByText(/chance for the seller/).waitFor({ timeout: 90000 });
      const kept = await page.locator("button[aria-label^='Exhibit ']").count();
      const call = await page.locator("p", { hasText: /chance for the seller/ }).first().innerText();
      console.log(vp.width, "argued:", call.replace(/\s+/g, " "), "marks:", kept, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
      const id = page.url().split("/case/")[1].split("?")[0];
      const pdf = await page.request.get(`${base}/api/cases/${id}/pdf`);
      console.log(vp.width, "pdf", pdf.status(), (await pdf.body()).length, "bytes");
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      console.log(vp.width, "scrollWidth", sw);
    } else {
      await page.goto(base + "/case/PP-R-OCC-10190303", { waitUntil: "load" });
      await page.getByText(/chance for the seller/).waitFor({ timeout: 30000 });
      await page.locator("button[aria-label^='Exhibit B']").first().click();
      await page.getByText("The order").first().waitFor();
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      console.log(vp.width, "case ok, inline exhibit opens, scrollWidth", sw);
    }
    console.log(vp.width, errors.length ? "CONSOLE ERRORS: " + errors.join(" | ").slice(0, 600) : "no console errors");
    await page.close();
  }
  await browser.close();
})().catch((e) => {
  console.error("E2E FAILED", e.message);
  process.exit(1);
});
