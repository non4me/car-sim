// Capture the route auto-pilot mid LEFT turn, staying in its RHT lane (right of the painted centreline)
// on a larger radius — visual proof of the outer-turn fix. Drives on the real RAF loop and shoots the
// first good left-turn frame. → docs/shots/autopilot-outer-turn.png
import puppeteer from "/Users/vt/.npm/_npx/ab5cd9f6d13a2312/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const CHROME = "/Users/vt/.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const URL = "https://car-sim.troyanenko.com/drive?x=" + Math.floor(Math.random() * 1e9);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ headless: "new", executablePath: CHROME, args: ["--no-sandbox", "--window-size=900,900"] });
const p = await b.newPage();
await p.setViewport({ width: 900, height: 900, deviceScaleFactor: 2 });
await p.evaluateOnNewDocument(() => { localStorage.setItem("carsim_help_seen", "1"); localStorage.setItem("carsim_zoom", "24"); });
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
await pick("#routeFrom", "#routeFromRes", "Anglická");
await pick("#routeTo", "#routeToRes", "Bělehradská");
await p.evaluate(() => document.getElementById("routeGo").click());
await p.waitForFunction(() => /km|nenalezena|chyba/.test(document.getElementById("routeInfo").textContent), { timeout: 20000 });
await sleep(800);
await p.evaluate(() => window.__drive.driveRoute(window.__drive.routeLine()));
await sleep(1500);

// poll until the car is moving INTO a left turn (turn ahead > 0.45 rad, v > 3 m/s), then shoot
const STATE = () => {
  const d = window.__drive, car = d.car, R = d.routeLine();
  let bi = 0, bd = Infinity;
  for (let i = 0; i < R.length - 1; i++) { const dd = (car.x - R[i][0]) ** 2 + (car.y - R[i][1]) ** 2; if (dd < bd) { bd = dd; bi = i; } }
  let pdx = R[bi + 1] ? R[bi + 1][0] - R[bi][0] : 1, pdy = R[bi + 1] ? R[bi + 1][1] - R[bi][1] : 0;
  const pl = Math.hypot(pdx, pdy) || 1; pdx /= pl; pdy /= pl;
  let signed = 0, acc = 0;
  for (let k = bi + 1; k < R.length - 1 && acc < 14; k++) { let nx = R[k + 1][0] - R[k][0], ny = R[k + 1][1] - R[k][1]; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl; signed += Math.atan2(pdx * ny - pdy * nx, pdx * nx + pdy * ny); acc += nl; pdx = nx; pdy = ny; }
  return { turn: signed, v: car.v, following: d.following(), kmh: car.speedKmh };
};
let shot = false;
const t0 = Date.now();
while (Date.now() - t0 < 120000) {
  const s = await p.evaluate(STATE);
  if (s.turn > 0.45 && s.v > 3) {
    await p.screenshot({ path: "docs/shots/autopilot-outer-turn.png" });
    console.log(JSON.stringify({ shot: true, turn: +s.turn.toFixed(2), kmh: s.kmh }));
    shot = true; break;
  }
  if (s.following === false) break;
  await sleep(80);
}
if (!shot) console.log(JSON.stringify({ shot: false }));
await b.close();
