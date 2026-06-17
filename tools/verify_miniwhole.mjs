// Verify msg 2777: (1) auto-follow keeps the normal car-following main-window camera (NO zoom-out),
// (2) the "Zobrazit celou trasu" button shows the whole route in the minimap.
import puppeteer from '/Users/vt/.npm/_npx/ab5cd9f6d13a2312/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const CHROME = '/Users/vt/.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const URL = 'https://car-sim.troyanenko.com/drive?district=prague';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--window-size=1280,860'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 860 });
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  page.on('console', (m) => { const t = m.text(); if (/error|undefined is not|TypeError/i.test(t)) console.log('CONSOLE', t); });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('carsim_help_seen', '1'));
  // clear any persisted car position so spawn is deterministic-ish, then reload
  await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('carsim_pos_')).forEach(k => localStorage.removeItem(k)));
  await page.reload({ waitUntil: 'domcontentloaded' });

  // wait for the sim harness + a non-empty search index (needed to pick a destination)
  await page.waitForFunction(() => window.__drive && window.__drive.car, { timeout: 20000 });
  await sleep(1500);

  // open the route panel (prefills "Odkud" with the current street)
  await page.click('#routeBtn');
  await sleep(400);
  const fromVal = await page.$eval('#routeFrom', (el) => el.value);

  // type a far destination + Enter to pick the top-ranked result
  await page.focus('#routeTo');
  await page.type('#routeTo', 'Vinohrady', { delay: 30 });
  await sleep(500);
  await page.keyboard.press('Enter');
  await sleep(300);
  const toVal = await page.$eval('#routeTo', (el) => el.value);

  // compute the route
  await page.click('#routeGo');
  await page.waitForFunction(() => window.__drive.routeLine() && window.__drive.routeLine().length > 1, { timeout: 15000 });
  const routeLen = await page.evaluate(() => window.__drive.routeLine().length);
  const btnState = await page.evaluate(() => ({
    followDisabled: document.getElementById('routeFollow').disabled,
    wholeDisabled: document.getElementById('routeWhole').disabled,
  }));

  // turn ON auto-follow, then drive forward a bit and confirm the MAIN window keeps following the car
  // (normal driving zoom, camera centred on the car) — it must NOT collapse to fit the whole route.
  await page.evaluate(() => { const f = document.getElementById('routeFollow'); f.checked = true; f.dispatchEvent(new Event('change')); });
  await page.evaluate(() => window.__drive.set({ throttle: 1 }));
  await page.evaluate(() => window.__drive.tick(150));
  const camFollow = await page.evaluate(() => {
    const v = window.__drive.view, c = window.__drive.car;
    return { zoom: +v.zoom.toFixed(2), camDx: +Math.hypot(v.cx - c.x, v.cy - c.y).toFixed(1), following: window.__drive.following() };
  });

  // now show the whole route in the minimap
  await page.evaluate(() => window.__drive.set({ throttle: 0 }));
  await page.click('#routeWhole');
  await page.evaluate(() => window.__drive.tick(2));
  await sleep(200);
  const wholeBtnOn = await page.evaluate(() => document.getElementById('routeWhole').classList.contains('on'));
  // sample the minimap canvas to confirm it drew the blue route ribbon (non-empty, has blue-ish pixels)
  const miniHasRoute = await page.evaluate(() => {
    const cv = document.getElementById('mini');
    if (!cv) return { found: false };
    const g = cv.getContext('2d');
    const { width: w, height: h } = cv;
    const d = g.getImageData(0, 0, w, h).data;
    let blue = 0, lit = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      if (b > 120 && b > r + 30 && b > gg + 10) blue++;
      if (r + gg + b > 80) lit++;
    }
    return { found: true, w, h, blue, lit };
  });

  await page.screenshot({ path: 'docs/shots/miniwhole-route.png' });

  console.log(JSON.stringify({ fromVal, toVal, routeLen, btnState, camFollow, wholeBtnOn, miniHasRoute }, null, 2));
} finally {
  await browser.close();
}
