import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const outDir = path.resolve('screenshots');
const session = JSON.parse(fs.readFileSync('/tmp/4dx-session.json', 'utf8'));
const executablePath = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'].find(p => fs.existsSync(p));

const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate((s) => localStorage.setItem('session', JSON.stringify(s)), session);
await page.reload({ waitUntil: 'networkidle0', timeout: 60000 });

for (const btn of await page.$$('.sidebar nav button')) {
  if ((await page.evaluate(el => el.textContent, btn)).includes('Admin')) { await btn.click(); break; }
}
await page.waitForSelector('.admin-dev-panel', { timeout: 20000 });
await page.evaluate(() => document.querySelector('.admin-dev-panel')?.scrollIntoView({ block: 'start' }));
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: path.join(outDir, 'admin-dev-panel.png'), fullPage: false });

for (const btn of await page.$$('.sidebar nav button')) {
  if ((await page.evaluate(el => el.textContent, btn)).includes('Scoreboard')) { await btn.click(); break; }
}
await page.waitForSelector('.scoreboard-table .scoreboard-row', { timeout: 20000 });
await page.click('.scoreboard-table .sb-link.sb-measure');
await page.waitForSelector('.pw-composer', { timeout: 25000 });
await page.click('.pw-composer .pw-segment button.active');
await page.screenshot({ path: path.join(outDir, 'progress-slider.png'), fullPage: false });
console.log('saved admin-dev-panel.png and progress-slider.png');

for (const btn of await page.$$('.sidebar nav button')) {
  if ((await page.evaluate(el => el.textContent, btn)).includes('Projects')) { await btn.click(); break; }
}
await page.waitForSelector('.pf-grid', { timeout: 20000 });
await page.screenshot({ path: path.join(outDir, 'projects-after-reseed.png'), fullPage: false });

await browser.close();
