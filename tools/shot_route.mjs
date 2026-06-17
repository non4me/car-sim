// Clean marketing-grade screenshot of the route finder (no first-visit help overlay).
import puppeteer from "/Users/vt/.npm/_npx/ab5cd9f6d13a2312/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const CHROME = "/Users/vt/.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const URL = "https://car-sim.troyanenko.com/drive?x=" + Math.floor(Math.random() * 1e9);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await puppeteer.launch({ headless: "new", executablePath: CHROME, args: ["--no-sandbox", "--window-size=1280,860"] });
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 860, deviceScaleFactor: 2 });
// dismiss the help overlay + start a touch zoomed-out so more of the ribbon shows
await p.evaluateOnNewDocument(() => {
  localStorage.setItem("carsim_help_seen", "1");
  localStorage.setItem("carsim_zoom", "7");
});
await p.goto(URL, { waitUntil: "networkidle2", timeout: 45000 });
await p.waitForFunction(() => window.__drive && window.__drive.map, { timeout: 30000 });
await sleep(1200);

await p.evaluate(() => document.getElementById("routeBtn").click());
await sleep(300);
async function pick(isel, resSel, q) {
  await p.evaluate((s, v) => { const e = document.querySelector(s); e.focus(); e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); }, isel, q);
  await p.waitForFunction((s) => { const r = document.querySelector(s); return r && !r.classList.contains("hidden") && r.querySelector(".sr-item"); }, { timeout: 8000 }, resSel);
  await p.evaluate((s) => document.querySelector(s + " .sr-item").dispatchEvent(new MouseEvent("mousedown", { bubbles: true })), resSel);
  await sleep(250);
}
await pick("#routeFrom", "#routeFromRes", "Vinohradská");
await pick("#routeTo", "#routeToRes", "Korunní");
await p.evaluate(() => document.getElementById("routeGo").click());
await p.waitForFunction(() => /km|nenalezena|chyba/.test(document.getElementById("routeInfo").textContent), { timeout: 20000 });
await sleep(2000);
await p.evaluate(() => window.__drive.tick(2));
await sleep(200);
await p.screenshot({ path: "docs/shots/route-clean.png" });
console.log("info:", await p.evaluate(() => document.getElementById("routeInfo").textContent));
await b.close();
