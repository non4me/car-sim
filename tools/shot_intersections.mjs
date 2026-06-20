import puppeteer from "/Users/vt/.npm/_npx/ab5cd9f6d13a2312/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import fs from "fs";
const CHROME = "/Users/vt/.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const P = { lat0:50.059, lon0:14.4655, kx:71467.2662474466, ky:110540 };
const toXY = (lat,lon) => [ (lon-P.lon0)*P.kx, (lat-P.lat0)*P.ky ];

const J = JSON.parse(fs.readFileSync("/tmp/isect.json","utf8"));
const pick=(arr,n)=>arr.slice(0,n);
const small=(arr,n)=>arr.slice().sort((a,b)=>(a.gap_m||a.overshoot_m||0)-(b.gap_m||b.overshoot_m||0)).slice(0,n);
const targets=[
  ...pick(J.unnoded,3).map((r,i)=>({label:`unnoded_${i}`, ...r})),
  ...pick(J.overshoots,3).map((r,i)=>({label:`overshoot_big_${i}`, ...r})),
  ...small(J.gaps,3).map((r,i)=>({label:`gap_small_${i}`, ...r})),
  ...pick(J.gaps,3).map((r,i)=>({label:`gap_big_${i}`, ...r})),
];

const b = await puppeteer.launch({ headless:"new", executablePath:CHROME, args:["--no-sandbox","--window-size=900,900"] });
const p = await b.newPage();
await p.setViewport({ width:900, height:900, deviceScaleFactor:2 });
await p.evaluateOnNewDocument(()=>{ localStorage.setItem("carsim_help_seen","1"); localStorage.setItem("carsim_zoom","24"); });
await p.goto("https://car-sim.troyanenko.com/drive?x="+Math.floor(Math.random()*1e9), { waitUntil:"networkidle2", timeout:45000 });
await p.waitForFunction(()=>window.__drive && window.__drive.map && window.__drive.map.edges.length>0, { timeout:30000 });
await sleep(1500);
for (const t of targets){
  const [x,y]=toXY(t.lat,t.lon);
  await p.evaluate((x,y)=>{ const d=window.__drive; d.car.x=x; d.car.y=y; d.car.v=0; d.car.h=0; d.view.zoom=24; }, x, y);
  await p.evaluate(()=>{ for(let i=0;i<6;i++) window.__drive.tick(1); });   // let zoom/camera settle on the point
  await sleep(250);
  await p.screenshot({ path:`docs/shots/isect/${t.label}.png` });
  console.log(t.label, JSON.stringify({lat:t.lat,lon:t.lon,gap:t.gap_m,over:t.overshoot_m,D:t.D,wS:t.wS,wM:t.wM}));
}
await b.close(); console.log("DONE",targets.length,"shots");
