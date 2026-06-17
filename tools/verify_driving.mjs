// Deterministic verification of msg-2759 driving changes via the window.__drive harness
// (tick() advances the sim a fixed dt, immune to RAF throttling). Tests:
//   1) off-road: speed is NOT zeroed when driving off the road (no braking)
//   2) lane-align: heading eases onto the road tangent when cruising straight
//   3) route auto-pilot: with a route + follow on + throttle, the car drives to the destination
import puppeteer from "/Users/vt/.npm/_npx/ab5cd9f6d13a2312/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const CHROME = "/Users/vt/.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const URL = "https://car-sim.troyanenko.com/drive?x=" + Math.floor(Math.random() * 1e9);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await puppeteer.launch({ headless: "new", executablePath: CHROME, args: ["--no-sandbox", "--window-size=1100,820"] });
const p = await b.newPage();
await p.setViewport({ width: 1100, height: 820, deviceScaleFactor: 1 });
await p.evaluateOnNewDocument(() => { localStorage.setItem("carsim_help_seen", "1"); localStorage.setItem("carsim_zoom", "16"); });
await p.goto(URL, { waitUntil: "networkidle2", timeout: 45000 });
await p.waitForFunction(() => window.__drive && window.__drive.map && window.__drive.map.edges.length, { timeout: 30000 });
await sleep(1200);
await p.evaluate(() => window.__drive.tick(3));

// ---- Test 1: off-road does not brake ----
const t1 = await p.evaluate(() => {
  const d = window.__drive, car = d.car;
  // put the car well off any road: find a point far from the nearest edge near spawn
  const ox = car.x + 25, oy = car.y + 25;       // nudge off
  car.x = ox; car.y = oy; car.v = 8; car.h = Math.atan2(25, 25);
  d.set({ throttle: 1, brake: 0, hard: false, turn: 0 });   // accelerate forward, off-road
  const vBefore = car.v;
  for (let i = 0; i < 60; i++) d.tick(1);
  const r = d.rules();
  const out = { offRoad: r.offRoad, boundary: r.boundary, vBefore, vAfter: car.v };
  d.clear();
  return out;
});

// ---- Test 2: lane-align eases heading onto the road ----
const t2 = await p.evaluate(() => {
  const d = window.__drive, car = d.car, map = d.map;
  // snap onto a real road first
  let ne = map.nearestEdge(car.x, car.y);
  if (ne.edge) { car.x = ne.px; car.y = ne.py; car.h = Math.atan2(ne.ty, ne.tx); }
  ne = map.nearestEdge(car.x, car.y);
  const roadH = Math.atan2(ne.ty, ne.tx);
  car.h = roadH + 0.35;                          // knock heading ~20° off the road
  car.v = 6;
  const before = Math.abs(Math.atan2(Math.sin(car.h - roadH), Math.cos(car.h - roadH)));
  d.set({ throttle: 1, brake: 0, hard: false, turn: 0 });   // cruise straight, no steering
  for (let i = 0; i < 40; i++) d.tick(1);
  const ne2 = map.nearestEdge(car.x, car.y);
  const roadH2 = Math.atan2(ne2.ty, ne2.tx);
  const after = Math.abs(Math.atan2(Math.sin(car.h - roadH2), Math.cos(car.h - roadH2)));
  d.clear();
  return { beforeDeg: +(before * 57.3).toFixed(1), afterDeg: +(after * 57.3).toFixed(1), onSurface: d.rules().onSurface };
});

// ---- Test 3: route auto-pilot drives to the destination ----
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
await p.evaluate(() => { document.getElementById("routeFollow").checked = false; document.getElementById("routeGo").click(); });
await p.waitForFunction(() => /km|nenalezena|chyba/.test(document.getElementById("routeInfo").textContent), { timeout: 20000 });
await sleep(1500);   // let goTo snap the car onto the route start

const t3 = await p.evaluate(async () => {
  const d = window.__drive;
  const total = d.map ? null : null;
  // turn auto-pilot on
  const f = document.getElementById("routeFollow"); f.checked = true; f.dispatchEvent(new Event("change", { bubbles: true }));
  const routeLen = window.__routeLen || null;
  d.set({ throttle: 1, brake: 0, hard: false, turn: 0 });   // press the gas; steering is automatic
  let maxDevia = 0, arrived = false;
  const end = null;
  // sample deviation from the route while driving + detect arrival (follow auto-clears)
  for (let i = 0; i < 1500; i++) {
    d.tick(1);
    if (!document.getElementById("routeFollow").checked) { arrived = true; break; }
  }
  const info = document.getElementById("routeInfo").textContent;
  d.clear();
  return { arrived, info, kmh: d.car.speedKmh };
});

console.log(JSON.stringify({ t1, t2, t3 }, null, 2));
await b.close();
