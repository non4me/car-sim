// Screenshot the accounts UI on production: /login, then log in as the seeded admin → /admin + /me.
import puppeteer from '/Users/vt/.npm/_npx/ab5cd9f6d13a2312/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
const CHROME = '/Users/vt/.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const BASE = 'https://car-sim.troyanenko.com';
const EMAIL = process.env.ADMIN_EMAIL, PW = process.env.ADMIN_PASSWORD;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--window-size=1100,820'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 820 });

  await page.goto(BASE + '/login', { waitUntil: 'networkidle2' });
  await page.screenshot({ path: 'docs/shots/acc-login.png' });

  // log in as admin via the email form
  await page.type('#em', EMAIL, { delay: 15 });
  await page.type('#pw', PW, { delay: 15 });
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click('button.primary')]);

  await page.goto(BASE + '/me', { waitUntil: 'networkidle2' });
  await page.screenshot({ path: 'docs/shots/acc-me.png' });
  const meEmail = await page.evaluate(() => document.body.innerText.includes('@'));

  await page.goto(BASE + '/admin', { waitUntil: 'networkidle2' });
  await page.screenshot({ path: 'docs/shots/acc-admin.png' });
  const adminTitle = await page.evaluate(() => document.querySelector('h1') && document.querySelector('h1').innerText);
  const rows = await page.evaluate(() => document.querySelectorAll('table tr').length);

  console.log(JSON.stringify({ meEmail, adminTitle, rows }, null, 2));
} finally {
  await browser.close();
}
