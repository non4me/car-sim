// Clean screenshot of the route auto-pilot: route set, "Automatické sledování trasy" ticked,
// car driving itself along the blue ribbon. Uses real RAF time so tiles stream as it moves.
import puppeteer from "/Users/vt/.npm/_npx/ab5cd9f6d13a2312/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const CHROME = "/Users/vt/.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ headless: "new", executablePath: CHROME, args: ["--no-sandbox", "--window-size=1100,820"] });
const p = await b.newPage();
await p.setViewport({ width: 1100, height: 820, deviceScaleFactor: 2 });
await p.evaluateOnNewDocument(() => { localStorage.setItem("carsim_help_seen", "1"); localStorage.setItem("carsim_zoom", "13"); });
await p.goto("https://car-sim.troyanenko.com/drive?x=" + Math.floor(Math.random() * 1e9), { waitUntil: "networkidle2", timeout: 45000 });
await p.waitForFunction(() => window.__drive && window.__drive.map && window.__drive.map.edges.length, { timeout: 30000 });
await sleep(1000);
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
await p.waitForFunction(() => /km/.test(document.getElementById("routeInfo").textContent), { timeout: 20000 });
await sleep(1500);
// tick the auto-pilot on and press the gas; real time so RAF drives + streams tiles
await p.evaluate(() => { const f = document.getElementById("routeFollow"); f.checked = true; f.dispatchEvent(new Event("change", { bubbles: true })); window.__drive.set({ throttle: 1, brake: 0, hard: false, turn: 0 }); });
await sleep(3500);    // let it drive a stretch along the route
await p.screenshot({ path: "docs/shots/autopilot.png" });
console.log("kmh:", await p.evaluate(() => window.__drive.car.speedKmh), "following:", await p.evaluate(() => window.__drive.following()));
await b.close();
