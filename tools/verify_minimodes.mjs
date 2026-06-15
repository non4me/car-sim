// Verify msg 2784: minimap City + Trasa modes on production.
import puppeteer from '/Users/vt/.npm/_npx/ab5cd9f6d13a2312/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
const CHROME = '/Users/vt/.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const URL = 'https://car-sim.troyanenko.com/drive?district=prague';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// count "lit" (non-background) + text-ish bright pixels in the minimap canvas
async function sampleMini(page) {
  return page.evaluate(() => {
    const cv = document.getElementById('mini'); const g = cv.getContext('2d');
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    let lit = 0, blue = 0, bright = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      if (r + gg + b > 90) lit++;
      if (b > 130 && b > r + 25) blue++;
      if (r > 180 && gg > 190 && b > 200) bright++;   // near-white label text
    }
    return { lit, blue, bright };
  });
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--window-size=1280,860'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 860 });
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.setItem('carsim_help_seen', '1'); Object.keys(localStorage).filter(k => k.startsWith('carsim_pos_')).forEach(k => localStorage.removeItem(k)); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__drive && window.__drive.car, { timeout: 20000 });
  await sleep(2000);   // let search.json (districts + landmarks) load

  const out = {};
  // local baseline
  await page.evaluate(() => window.__drive.tick(2));
  out.local = await sampleMini(page);

  // CITY mode
  await page.click('#miniCity');
  await page.evaluate(() => window.__drive.tick(3));
  await sleep(150);
  out.cityBtnOn = await page.evaluate(() => document.getElementById('miniCity').classList.contains('on'));
  out.city = await sampleMini(page);
  await page.screenshot({ path: 'docs/shots/mini-city.png' });

  // back to local, then build a route to enable Trasa
  await page.click('#miniCity');   // toggle off
  out.routeDisabledBefore = await page.evaluate(() => document.getElementById('miniRoute').disabled);
  await page.click('#routeBtn'); await sleep(300);
  await page.focus('#routeTo'); await page.type('#routeTo', 'Letiště', { delay: 25 }); await sleep(500);
  await page.keyboard.press('Enter'); await sleep(250);
  await page.click('#routeGo');
  await page.waitForFunction(() => window.__drive.routeLine() && window.__drive.routeLine().length > 1, { timeout: 15000 });
  await page.evaluate(() => window.__drive.tick(2));
  out.routeDisabledAfter = await page.evaluate(() => document.getElementById('miniRoute').disabled);

  // TRASA mode
  await page.click('#miniRoute');
  await page.evaluate(() => window.__drive.tick(3));
  await sleep(150);
  out.routeBtnOn = await page.evaluate(() => document.getElementById('miniRoute').classList.contains('on'));
  out.trasa = await sampleMini(page);
  await page.screenshot({ path: 'docs/shots/mini-trasa.png' });

  console.log(JSON.stringify(out, null, 2));
} finally {
  await browser.close();
}
