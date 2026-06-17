// Verify pedestrian-crossing (zebra) rendering: teleport the car onto a known crossing,
// let its tile stream in, zoom in close, and screenshot the zebra ladder.
import puppeteer from "/Users/vt/.npm/_npx/ab5cd9f6d13a2312/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const CHROME = "/Users/vt/.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const URL = "https://car-sim.troyanenko.com/drive?x=" + Math.floor(Math.random() * 1e9);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CX = -80.1, CY = -62.5, TX = 0.919, TY = 0.394;   // the verified central crossing

const b = await puppeteer.launch({ headless: "new", executablePath: CHROME, args: ["--no-sandbox", "--window-size=1100,820"] });
const p = await b.newPage();
await p.setViewport({ width: 1100, height: 820, deviceScaleFactor: 2 });
await p.evaluateOnNewDocument(() => { localStorage.setItem("carsim_help_seen", "1"); localStorage.setItem("carsim_zoom", "20"); });
await p.goto(URL, { waitUntil: "networkidle2", timeout: 45000 });
await p.waitForFunction(() => window.__drive && window.__drive.map, { timeout: 30000 });

// teleport the car a few metres before the crossing, facing along the road tangent
await p.evaluate(({ cx, cy, tx, ty }) => {
  const d = window.__drive;
  d.car.x = cx - tx * 9; d.car.y = cy - ty * 9; d.car.h = Math.atan2(ty, tx); d.car.v = 0;
}, { cx: CX, cy: CY, tx: TX, ty: TY });

// stream the destination tile in: pump the loop until a crossing is resident near the car
const near = await p.evaluate(async ({ cx, cy }) => {
  const d = window.__drive, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 40; i++) {
    d.tick(1);
    const c = (d.map.crossings || []).filter((q) => Math.hypot(q.x - cx, q.y - cy) < 40);
    if (c.length) return { count: d.map.crossings.length, nearby: c.length };
    await sleep(80);
  }
  return { count: (d.map.crossings || []).length, nearby: 0 };
}, { cx: CX, cy: CY });

await p.evaluate(() => window.__drive.tick(2));
await sleep(300);
await p.screenshot({ path: "docs/shots/zebra-verify.png" });
console.log(JSON.stringify(near));
await b.close();
