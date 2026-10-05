// Product screenshots for the README and the gallery: node scripts/readme-shots.cjs [base]
const { chromium } = require("I:/Programs/ListofHackathon/hackathons/01-arbitrum-open-house/submission/video/node_modules/playwright");
const base = process.argv[2] || "https://exhibit-desk.vercel.app";
const out = "docs/screens";
const FILED = process.env.FILED || "PP-R-MBE-10190310";
const REFUNDED = process.env.REFUNDED || "PP-R-XMQ-10190316";
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
  await desk.evaluate(() => window.scrollTo(0, 0));
  await desk.waitForTimeout(600);
  await desk.screenshot({ path: `${out}/home-top.png` });
  await scrollTo(desk, "h2:has-text('No claim without a record')", 140);
  await desk.waitForTimeout(500);
  await desk.screenshot({ path: `${out}/checker.png` });

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

  await desk.goto(base + "/new", { waitUntil: "load" });
  await desk.waitForTimeout(800);
  await desk.screenshot({ path: `${out}/new.png` });
  await desk.goto(base + "/desk", { waitUntil: "load" });
  await desk.locator(".ag-row").first().waitFor();
  await desk.waitForTimeout(800);
  await desk.screenshot({ path: `${out}/desk.png` });

  const pdf = await desk.request.get(`${base}/api/cases/${FILED}/pdf`);
  require("fs").writeFileSync(`${out}/response.pdf`, await pdf.body());

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
