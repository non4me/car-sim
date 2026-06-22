// Outer-turn lane discipline: does the route auto-pilot stay in its RHT lane through turns, or
// cut the corner LEFT across the centreline into oncoming? (Vlad: outer turns must take a larger
// radius.) Drives several routes on the REAL RAF loop (NOT the sync tick() — that mismeasures speed
// because onSurface is tile-dependent, and speed drives the look-ahead), polling the signed lateral
// offset from the route centreline (+ = LEFT of travel = oncoming side) bucketed by the local turn
// direction. Also tracks off-road samples so we can confirm the msg-3165 fix isn't regressed.
//
// Usage: node tools/verify_outer_turns.mjs <label>   (writes /tmp/outer-turns-<label>.json)
import puppeteer from "/Users/vt/.npm/_npx/ab5cd9f6d13a2312/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const CHROME = "/Users/vt/.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const LABEL = process.argv[2] || "run";
const URL = "https://car-sim.troyanenko.com/drive?x=" + Math.floor(Math.random() * 1e9);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROUTES = [
  ["Vinohradská", "Korunní"], ["Korunní", "Vinohradská"],
  ["Slezská", "Francouzská"], ["Francouzská", "Slezská"],
  ["Anglická", "Bělehradská"],
];

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
  await p.waitForFunction((s) => { const r = document.querySelector(s); return r && !r.classList.contains("hidden") && r.querySelector(".sr-item"); }, { timeout: 6000 }, resSel);
  await p.evaluate((s) => document.querySelector(s + " .sr-item").dispatchEvent(new MouseEvent("mousedown", { bubbles: true })), resSel);
  await sleep(250);
}

// one live sample computed in-page off the RAF-driven state
const SAMPLE = () => {
  const d = window.__drive, car = d.car, R = d.routeLine(), r = d.rules ? d.rules() : null;
  const o = { x: car.x, y: car.y, kmh: car.speedKmh, following: d.following(),
              onSurface: r ? r.onSurface : null, oncoming: r ? r.oncoming : null, width: r ? r.width : 7 };
  if (R && R.length > 1) {
    let bi = 0, bd = Infinity, bt = 0;
    for (let i = 0; i < R.length - 1; i++) {
      const ax = R[i][0], ay = R[i][1], dx = R[i + 1][0] - ax, dy = R[i + 1][1] - ay, l2 = dx * dx + dy * dy;
      let t = l2 ? ((car.x - ax) * dx + (car.y - ay) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
      const cx = ax + t * dx, cy = ay + t * dy, dd = (car.x - cx) ** 2 + (car.y - cy) ** 2;
      if (dd < bd) { bd = dd; bi = i; bt = t; }
    }
    const ax = R[bi][0], ay = R[bi][1], dx = R[bi + 1][0] - ax, dy = R[bi + 1][1] - ay, L = Math.hypot(dx, dy) || 1;
    const tx = dx / L, ty = dy / L, px = ax + bt * dx, py = ay + bt * dy;
    o.idx = bi;
    o.offL = tx * (car.y - py) - ty * (car.x - px);     // >0 = LEFT of travel dir = oncoming side
    let pdx = tx, pdy = ty, signed = 0, acc = 0;
    for (let k = bi + 1; k < R.length - 1 && acc < 14; k++) {
      let nx = R[k + 1][0] - R[k][0], ny = R[k + 1][1] - R[k][1]; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
      signed += Math.atan2(pdx * ny - pdy * nx, pdx * nx + pdy * ny); acc += nl; pdx = nx; pdy = ny;
    }
    o.turn = signed;                                     // + = left turn ahead, − = right
  }
  return o;
};

const routes = [];
for (const [from, to] of ROUTES) {
  try {
    await p.evaluate(() => { const c = document.getElementById("routeClear"); if (c) c.click(); });
    await sleep(200);
    await pick("#routeFrom", "#routeFromRes", from);
    await pick("#routeTo", "#routeToRes", to);
    await p.evaluate(() => document.getElementById("routeGo").click());
    await p.waitForFunction(() => /km|nenalezena|chyba/.test(document.getElementById("routeInfo").textContent), { timeout: 20000 });
    const info = await p.evaluate(() => document.getElementById("routeInfo").textContent);
    if (!/km/.test(info)) { routes.push({ from, to, skipped: info }); continue; }
    // engage the autopilot cleanly from the route start (same path the route panel uses)
    await p.evaluate(() => window.__drive.driveRoute(window.__drive.routeLine()));
    await sleep(1500);   // let the car settle on the start + tiles stream

    const samples = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 170000) {
      const s = await p.evaluate(SAMPLE);
      samples.push(s);
      if (s.following === false && samples.length > 20) break;   // arrived → finishRoute untoggled
      await sleep(120);
    }
    await p.evaluate(() => { const c = document.getElementById("routeClear"); if (c) c.click(); });

    // analyse — drop tracking-loss samples (car off the route while tiles stream) and the first 1.5 s
    const valid = samples.slice(8).filter((s) => s.offL != null && Math.abs(s.offL) < 12);
    const bucket = (name, pred) => {
      const xs = valid.filter(pred);
      if (!xs.length) return { name, n: 0 };
      const offs = xs.map((s) => s.offL);
      const maxLeft = Math.max(...offs);                 // most into oncoming (+)
      const meanOff = offs.reduce((a, c) => a + c, 0) / offs.length;
      const onc = xs.filter((s) => s.offL > 0.8).length; // crossed >0.8 m into oncoming half
      return { name, n: xs.length, maxLeft: +maxLeft.toFixed(2), meanOff: +meanOff.toFixed(2),
               oncomingFrac: +(onc / xs.length).toFixed(3) };
    };
    const offroad = valid.filter((s) => s.onSurface === false).length;
    routes.push({
      from, to, info, samples: samples.length, valid: valid.length, arrived: samples.at(-1)?.following === false,
      offroadFrac: +(offroad / Math.max(1, valid.length)).toFixed(3),
      maxKmh: Math.max(...samples.map((s) => s.kmh || 0)),
      left: bucket("left-turn", (s) => s.turn > 0.2),
      right: bucket("right-turn", (s) => s.turn < -0.2),
      straight: bucket("straight", (s) => Math.abs(s.turn) <= 0.2),
    });
    console.error(`done ${from}→${to}: left.maxLeft=${routes.at(-1).left.maxLeft} left.oncFrac=${routes.at(-1).left.oncomingFrac} offroad=${routes.at(-1).offroadFrac}`);
  } catch (e) {
    routes.push({ from, to, error: String(e).slice(0, 120) });
    console.error(`FAIL ${from}→${to}: ${String(e).slice(0, 120)}`);
  }
}
await b.close();
const fs = await import("node:fs");
const out = { label: LABEL, url: URL, routes };
fs.writeFileSync(`/tmp/outer-turns-${LABEL}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
