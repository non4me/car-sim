// Verify msg 2786: on-road street labels (and other map text) no longer overlap.
import puppeteer from '/Users/vt/.npm/_npx/ab5cd9f6d13a2312/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
const CHROME = '/Users/vt/.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const URL = 'https://car-sim.troyanenko.com/drive?district=prague';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--window-size=1280,860'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 860 });
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('carsim_help_seen', '1');
    localStorage.setItem('carsim_zoom', '10');     // zoomed-out a bit → denser labels, stresses de-overlap
    Object.keys(localStorage).filter((k) => k.startsWith('carsim_pos_')).forEach((k) => localStorage.removeItem(k));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__drive && window.__drive.car, { timeout: 20000 });
  await sleep(1500);

  // settle at the spawn (Na Bohdalci area — Vlad's screenshot location), then screenshot
  await page.evaluate(() => window.__drive.tick(20));
  await sleep(300);
  await page.screenshot({ path: 'docs/shots/labels-spawn.png' });

  // drive forward to a junction and screenshot again (different label cluster)
  await page.evaluate(() => window.__drive.set({ throttle: 1 }));
  await page.evaluate(() => window.__drive.tick(220));
  await page.evaluate(() => window.__drive.set({ throttle: 0 }));
  await page.evaluate(() => window.__drive.tick(8));
  await sleep(300);
  const st = await page.evaluate(() => window.__drive.tick(1));
  await page.screenshot({ path: 'docs/shots/labels-driven.png' });

  console.log(JSON.stringify({ at: st }, null, 2));
} finally {
  await browser.close();
}
