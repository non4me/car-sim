// Verify the route panel pre-fills "Odkud" with the street the car is on.
import puppeteer from "/Users/vt/.npm/_npx/ab5cd9f6d13a2312/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const CHROME = "/Users/vt/.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const URL = "https://car-sim.troyanenko.com/drive?x=" + Math.floor(Math.random() * 1e9);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await puppeteer.launch({ headless: "new", executablePath: CHROME, args: ["--no-sandbox", "--window-size=1100,820"] });
const p = await b.newPage();
await p.setViewport({ width: 1100, height: 820, deviceScaleFactor: 2 });
await p.evaluateOnNewDocument(() => { localStorage.setItem("carsim_help_seen", "1"); localStorage.setItem("carsim_zoom", "17"); });
await p.goto(URL, { waitUntil: "networkidle2", timeout: 45000 });
await p.waitForFunction(() => window.__drive && window.__drive.map, { timeout: 30000 });
await sleep(1500);
await p.evaluate(() => window.__drive.tick(3));   // settle the spawn snap + rules.street

const currentStreet = await p.evaluate(() => window.__drive.rules().street);
await p.evaluate(() => document.getElementById("routeBtn").click());
await sleep(400);
const res = await p.evaluate(() => ({
  panelOpen: !document.getElementById("routePanel").classList.contains("hidden"),
  fromValue: document.getElementById("routeFrom").value,
  goDisabled: document.getElementById("routeGo").disabled,
  info: document.getElementById("routeInfo").textContent,
}));
await p.screenshot({ path: "docs/shots/routefrom-verify.png" });
console.log(JSON.stringify({ currentStreet, ...res, match: currentStreet === res.fromValue }, null, 2));
await b.close();
