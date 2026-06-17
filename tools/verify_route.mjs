// Headless verification of the street-to-street route finder on production.
// Opens /drive, opens the route panel, picks two streets via autocomplete, clicks
// "Najít trasu", and screenshots the resulting blue route ribbon.
import puppeteer from "/Users/vt/.npm/_npx/ab5cd9f6d13a2312/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const CHROME = "/Users/vt/.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const URL = "https://car-sim.troyanenko.com/drive?x=" + Math.floor(Math.random() * 1e9);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: "new", executablePath: CHROME,
  args: ["--no-sandbox", "--window-size=1280,860"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 });
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message));

await page.goto(URL, { waitUntil: "networkidle2", timeout: 45000 });
await page.waitForFunction(() => window.__drive && window.__drive.map, { timeout: 30000 });
await sleep(1500);

// open the route panel
await page.evaluate(() => document.getElementById("routeBtn").click());
await sleep(400);
const panelOpen = await page.evaluate(() => !document.getElementById("routePanel").classList.contains("hidden"));
console.log("route panel open:", panelOpen);

// pick a street in an input via its autocomplete dropdown (drive via events, not synthetic clicks,
// so an overlaid panel can't fail a clickability check)
async function pickStreet(inputSel, resSel, query) {
  await page.evaluate((isel, q) => {
    const el = document.querySelector(isel);
    el.focus(); el.value = q;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, inputSel, query);
  await page.waitForFunction((s) => {
    const r = document.querySelector(s);
    return r && !r.classList.contains("hidden") && r.querySelector(".sr-item");
  }, { timeout: 8000 }, resSel);
  const picked = await page.evaluate((s) => {
    const it = document.querySelector(s + " .sr-item");
    const name = it.querySelector(".sr-name").textContent;
    it.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    return name;
  }, resSel);
  await sleep(300);
  return picked;
}

const from = await pickStreet("#routeFrom", "#routeFromRes", "Vinohradská");
const to = await pickStreet("#routeTo", "#routeToRes", "Korunní");

await page.evaluate(() => document.getElementById("routeGo").click());
// wait for the route to come back (info text flips to "trasa … km" or an error)
await page.waitForFunction(() => {
  const t = document.getElementById("routeInfo").textContent;
  return /km|nenalezena|chyba/.test(t);
}, { timeout: 20000 });
await sleep(1800);   // let goTo() stream tiles + snap, and a few frames render

const info = await page.evaluate(() => ({
  text: document.getElementById("routeInfo").textContent,
  cls: document.getElementById("routeInfo").className,
  // the route ribbon lives in a closure; prove it via the harness camera + a redraw tick
  pos: window.__drive.tick(2),
}));

await page.screenshot({ path: "docs/shots/route-verify.png" });
console.log(JSON.stringify({ from, to, info, errs }, null, 2));
await browser.close();
