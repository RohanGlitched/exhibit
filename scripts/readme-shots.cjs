// Product screenshots for the README and the gallery: node scripts/readme-shots.cjs [base]
// Case ids: FILED (a delivered case argued by the model and filed), REFUNDED (an accepted claim), AGENT (an
// order placed by a buyer's shopping agent). The PDF pages are rendered from the PDF PayPal holds for FILED.
const { chromium } = require("I:/Programs/ListofHackathon/hackathons/01-arbitrum-open-house/submission/video/node_modules/playwright");
const fs = require("fs");
const { execFileSync } = require("child_process");
const base = process.argv[2] || "https://exhibit-desk.vercel.app";
const out = "docs/screens";
const FILED = process.env.FILED || "PP-R-JON-10190567";
const REFUNDED = process.env.REFUNDED || "PP-R-DXN-10190574";
const AGENT = process.env.AGENT || "PP-R-YTQ-10191473";
(async () => {
  const b = await chromium.launch({ args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] });
  const desk = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const scrollTo = (p, sel, off = 0) => p.locator(sel).first().evaluate((el, o) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - o), off);

  await desk.goto(base + "/", { waitUntil: "load" });
  await scrollTo(desk, "section[aria-label='A real case, argued']", 24);
  await desk.getByRole("button", { name: "Play it again" }).waitFor({ timeout: 60000 });
  await desk.mouse.move(1430, 10);
  await desk.waitForTimeout(800);
  await desk.screenshot({ path: `${out}/home-stage.png` });
  const hide = await desk.addStyleTag({ content: "body > header { visibility: hidden !important; }" });
  await desk.locator("section[aria-label='A real case, argued']").first().screenshot({ path: `${out}/stage-crop.png` });
  await hide.evaluate((el) => el.remove());
  await desk.evaluate(() => window.scrollTo(0, 0));
  await desk.waitForTimeout(600);
  await desk.screenshot({ path: `${out}/home-top.png` });
  await scrollTo(desk, "h2:has-text('No claim without a record')", 140);
  await desk.waitForTimeout(500);
  await desk.screenshot({ path: `${out}/checker.png` });
  await scrollTo(desk, "h2:has-text('AI agent did the buying')", 120);
  await desk.waitForTimeout(500);
  await desk.screenshot({ path: `${out}/home-agent.png` });

  await desk.goto(`${base}/case/${FILED}`, { waitUntil: "load" });
  await desk.getByText(/chance for the seller/).waitFor();
  await desk.evaluate(() => window.scrollTo(0, 230));
  await desk.waitForTimeout(700);
  const e = desk.locator("article[aria-label^='Exhibit E']").first();
  const box = await e.boundingBox();
  await desk.mouse.move(box.x + 80, box.y + 20);
  await desk.waitForTimeout(700);
  await desk.screenshot({ path: `${out}/case-threads.png` });
  await desk.mouse.move(1430, 10);
  await desk.evaluate(() => window.scrollTo(0, 0));
  await desk.waitForTimeout(500);
  await desk.screenshot({ path: `${out}/case-filed.png` });

  await desk.goto(`${base}/case/${REFUNDED}`, { waitUntil: "load" });
  await desk.getByText(/chance for the seller/).waitFor();
  await desk.evaluate(() => window.scrollTo(0, 230));
  await desk.waitForTimeout(700);
  await desk.screenshot({ path: `${out}/case-refunded.png` });

  await desk.goto(`${base}/case/${AGENT}`, { waitUntil: "load" });
  await desk.getByText(/chance for the seller/).waitFor();
  await desk.evaluate(() => window.scrollTo(0, 300));
  const m = desk.locator("article[aria-label^='Exhibit F']").first();
  const mb = await m.boundingBox();
  await desk.mouse.move(mb.x + 80, mb.y + 20);
  await desk.waitForTimeout(700);
  await desk.screenshot({ path: `${out}/case-agent.png` });
  await desk.mouse.move(1430, 10);

  await desk.goto(base + "/new", { waitUntil: "load" });
  await desk.waitForTimeout(800);
  await desk.screenshot({ path: `${out}/new.png` });
  await desk.goto(base + "/desk", { waitUntil: "load" });
  await desk.locator(".ag-row").first().waitFor();
  await desk.waitForTimeout(800);
  await desk.screenshot({ path: `${out}/desk.png` });
  await desk.goto(base + "/desk/analytics", { waitUntil: "load" });
  await desk.waitForTimeout(10000);
  await scrollTo(desk, "h1", 90);
  await desk.waitForTimeout(500);
  await desk.screenshot({ path: `${out}/analytics.png` });
  await desk.goto(base + "/proof", { waitUntil: "load" });
  await desk.waitForTimeout(800);
  await desk.screenshot({ path: `${out}/proof.png` });
  await scrollTo(desk, "h2:has-text('Asked to state')", 40);
  await desk.waitForTimeout(500);
  await desk.screenshot({ path: `${out}/proof-pressure.png` });

  // The PDF exactly as PayPal holds it on the filed case, a page per PNG.
  const pdf = await desk.request.get(`${base}/api/cases/${FILED}/filed`);
  fs.writeFileSync(`${out}/response.pdf`, await pdf.body());
  execFileSync("python", ["-c", `import pymupdf\nd=pymupdf.open(r"${out}/response.pdf")\nfor i in range(min(3,len(d))): d[i].get_pixmap(dpi=150).save(r"${out}/pdf-%d.png"%(i+1))`]);

  const phone = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await phone.goto(base + "/", { waitUntil: "load" });
  await phone.waitForTimeout(1200);
  await phone.screenshot({ path: `${out}/phone-home.png` });
  await phone.goto(`${base}/case/${FILED}`, { waitUntil: "load" });
  await phone.getByText(/chance for the seller/).waitFor();
  await phone.evaluate(() => window.scrollTo(0, 330));
  await phone.locator("button[aria-label^='Exhibit E']").first().click();
  await phone.waitForTimeout(800);
  await phone.screenshot({ path: `${out}/phone-case.png` });
  await phone.goto(base + "/desk", { waitUntil: "load" });
  await phone.waitForTimeout(1500);
  await phone.screenshot({ path: `${out}/phone-desk.png` });
  await b.close();
  console.log("done");
})();
