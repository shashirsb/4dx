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
  if ((await page.evaluate(el => el.textContent, btn)).includes('Projects')) { await btn.click(); break; }
}
await page.waitForSelector('.pf-card', { timeout: 20000 });
await page.click('.pf-card');
await page.waitForSelector('.pw-wig-card', { timeout: 30000 });

const wigQuick = await page.$('.pw-wig-card .pw-quick-btn');
if (wigQuick) {
  await wigQuick.click();
  await page.waitForSelector('.progress-slider-range', { timeout: 10000 });
  await page.screenshot({ path: path.join(outDir, 'progress-slider.png'), fullPage: false });
  console.log('saved progress-slider.png (WIG quick edit)');
} else {
  await page.click('.pw-wig-open');
  await page.waitForSelector('.pw-measure-row', { timeout: 20000 });
  const measureBtn = await page.$('.pw-measure-row .pw-quick-btn');
  await measureBtn.click();
  await page.waitForSelector('.progress-slider-range', { timeout: 10000 });
  await page.screenshot({ path: path.join(outDir, 'progress-slider.png'), fullPage: false });
  console.log('saved progress-slider.png (measure quick edit)');
}

await browser.close();
