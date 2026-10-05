// Visits every page and reports console errors/warnings, page errors and failed requests.
const { chromium } = require("I:/Programs/ListofHackathon/hackathons/01-arbitrum-open-house/submission/video/node_modules/playwright");
const base = process.argv[2];
const paths = ["/", "/desk", "/new", "/case/PP-R-OCC-10190303", "/case/PP-R-SFY-10190306", "/case/PP-R-RGZ-10190305", "/case/PP-R-NOPE-1"];
(async () => {
  const browser = await chromium.launch({ args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] });
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport: vp });
    let cur = "";
    const out = [];
    page.on("console", (m) => ["error", "warning"].includes(m.type()) && out.push(`${vp.width} ${cur} [${m.type()}] ${m.text().slice(0, 300)}`));
    page.on("pageerror", (e) => out.push(`${vp.width} ${cur} [pageerror] ${String(e).slice(0, 300)}`));
    page.on("response", (r) => r.status() >= 400 && out.push(`${vp.width} ${cur} [http ${r.status()}] ${r.url()}`));
    for (const p of paths) {
      cur = p;
      await page.goto(base + p, { waitUntil: "load", timeout: 90000 });
      await page.waitForTimeout(p === "/" ? 9000 : 3500);
      const overlay = await page.evaluate(() => {
        const portal = document.querySelector("nextjs-portal");
        return portal?.shadowRoot?.textContent?.replace(/\s+/g, " ").slice(0, 300) ?? "";
      });
      if (overlay && /error|issue/i.test(overlay)) out.push(`${vp.width} ${p} [next overlay] ${overlay}`);
    }
    await page.close();
    console.log(out.length ? out.join("\n") : `${vp.width}: clean`);
  }
  await browser.close();
})();
