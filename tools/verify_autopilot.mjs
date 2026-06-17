// Focused diagnostic of the route auto-pilot: does the car TRACK the route (low deviation)
// and ARRIVE? Drives at a capped speed (release throttle above ~45 km/h, like a real driver
// through a city) and samples deviation from the route polyline + progress index each step.
import puppeteer from "/Users/vt/.npm/_npx/ab5cd9f6d13a2312/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const CHROME = "/Users/vt/.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const URL = "https://car-sim.troyanenko.com/drive?x=" + Math.floor(Math.random() * 1e9);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await puppeteer.launch({ headless: "new", executablePath: CHROME, args: ["--no-sandbox", "--window-size=1000,760"] });
const p = await b.newPage();
await p.setViewport({ width: 1000, height: 760, deviceScaleFactor: 1 });
await p.evaluateOnNewDocument(() => { localStorage.setItem("carsim_help_seen", "1"); localStorage.setItem("carsim_zoom", "16"); });
await p.goto(URL, { waitUntil: "networkidle2", timeout: 45000 });
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
await p.waitForFunction(() => /km|nenalezena|chyba/.test(document.getElementById("routeInfo").textContent), { timeout: 20000 });
await sleep(1500);

const res = await p.evaluate(async () => {
  const d = window.__drive, car = d.car;
  const f = document.getElementById("routeFollow"); f.checked = true; f.dispatchEvent(new Event("change", { bubbles: true }));
  // distance from a point to the whole route polyline
  const RL = () => d.__rl;     // not exposed; recompute deviation via map? fall back below
  let maxDev = 0, arrived = false, steps = 0;
  const devTo = (poly) => {
    let best = Infinity;
    for (let i = 1; i < poly.length; i++) {
      const ax = poly[i-1][0], ay = poly[i-1][1], bx = poly[i][0], by = poly[i][1];
      const dx = bx-ax, dy = by-ay, l2 = dx*dx+dy*dy;
      let t = l2 ? ((car.x-ax)*dx+(car.y-ay)*dy)/l2 : 0; t = Math.max(0,Math.min(1,t));
      const cx = ax+t*dx, cy = ay+t*dy, dd = Math.hypot(car.x-cx, car.y-cy);
      if (dd < best) best = dd;
    }
    return best;
  };
  // grab the route polyline off the harness if present, else skip deviation
  const poly = (d.routeLine && d.routeLine()) || null;
  const endPt = poly ? poly[poly.length - 1] : null;
  const distEnd = () => endPt ? Math.hypot(car.x - endPt[0], car.y - endPt[1]) : -1;
  const nearestIdx = () => { let bi = 0, bd = Infinity; for (let i = 0; i < poly.length; i++) { const dd = Math.hypot(car.x - poly[i][0], car.y - poly[i][1]); if (dd < bd) { bd = dd; bi = i; } } return bi; };
  const cap = 35;
  let maxIdx = 0, idxStallTicks = 0, diag = null;
  for (let i = 0; i < 16000; i++) {
    d.set({ throttle: car.speedKmh < cap ? 1 : 0, brake: 0, hard: false, turn: 0 });
    d.tick(1); steps++;
    if (poly) { const dev = devTo(poly); if (dev > maxDev) maxDev = dev; }
    const k = nearestIdx();
    if (k > maxIdx) { maxIdx = k; idxStallTicks = 0; } else { idxStallTicks++; }
    if (idxStallTicks > 900 && !diag) {              // route-index hasn't advanced for ~15 s → real stall
      const around = [];
      for (let j = Math.max(0, k - 1); j <= Math.min(poly.length - 1, k + 4); j++) around.push([Math.round(poly[j][0]), Math.round(poly[j][1])]);
      diag = { tick: i, nearIdx: k, maxIdx, ofN: poly.length, distEnd: +distEnd().toFixed(1),
               car: [Math.round(car.x), Math.round(car.y)], headingDeg: +(car.h * 57.3).toFixed(0), around };
      break;
    }
    if (!document.getElementById("routeFollow").checked) { arrived = true; break; }
  }
  d.clear();
  return { arrived, steps, capKmh: cap, maxDev: +maxDev.toFixed(1),
           maxIdx, ofN: poly.length, finalDistToEnd: +distEnd().toFixed(1), diag,
           info: document.getElementById("routeInfo").textContent, kmh: car.speedKmh };
});
console.log(JSON.stringify(res, null, 2));
await b.close();
