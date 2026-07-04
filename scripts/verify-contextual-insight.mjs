import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'screenshots');
fs.mkdirSync(outDir, { recursive: true });
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
await page.waitForSelector('.ai-insight-btn', { timeout: 30000 });

async function openInsightAndShot(name) {
  await page.click('.ai-insight-btn');
  await page.waitForSelector('.ai-insight-modal', { timeout: 30000 });
  await page.waitForFunction(() => {
    const loading = document.querySelector('.ai-insight-loading');
    const summary = document.querySelector('.ai-insight-summary p');
    const error = document.querySelector('.ai-insight-modal-body .ai-error');
    return (!loading && (summary?.textContent?.length > 0 || error)) || false;
  }, { timeout: 90000 });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: path.join(outDir, name), fullPage: false });
  await page.click('.ai-insight-modal-head .icon-btn');
  await page.waitForFunction(() => !document.querySelector('.ai-insight-modal'), { timeout: 5000 });
}

await openInsightAndShot('contextual-insight-project.png');

await page.waitForSelector('.pw-wig-card', { timeout: 20000 });
await page.evaluate(() => document.querySelector('.pw-wig-open')?.click());
await page.waitForSelector('.pw-measure-row', { timeout: 20000 });
await openInsightAndShot('contextual-insight-wig.png');

await page.evaluate(() => document.querySelector('.pw-measure-main')?.click());
await page.waitForSelector('.pw-composer', { timeout: 20000 });
await openInsightAndShot('contextual-insight-measure.png');

console.log('saved contextual insight screenshots');
await browser.close();
