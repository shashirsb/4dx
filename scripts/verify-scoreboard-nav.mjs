import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const sessionPath = '/tmp/4dx-session.json';
if (!fs.existsSync(sessionPath)) {
  const otpRes = await fetch('http://localhost:8000/api/auth/request-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9999900000' }),
  }).then(r => r.json());
  const verify = await fetch('http://localhost:8000/api/auth/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9999900000', otp: otpRes.demo_otp }),
  }).then(r => r.json());
  fs.writeFileSync(sessionPath, JSON.stringify(verify));
}
const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
const outDir = path.resolve('screenshots');
fs.mkdirSync(outDir, { recursive: true });

const executablePath = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].find(p => fs.existsSync(p));
if (!executablePath) throw new Error('Chrome not found');

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate((s) => localStorage.setItem('session', JSON.stringify(s)), session);
await page.reload({ waitUntil: 'networkidle0' });

for (const btn of await page.$$('.sidebar nav button')) {
  const text = await page.evaluate(el => el.textContent, btn);
  if (text.includes('Scoreboard')) { await btn.click(); break; }
}

await page.waitForSelector('.scoreboard-table .scoreboard-row', { timeout: 20000 });
await page.screenshot({ path: path.join(outDir, 'scoreboard-clickable.png'), fullPage: false });

const firstRow = await page.$('.scoreboard-table .scoreboard-row');
await firstRow.hover();
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: path.join(outDir, 'scoreboard-row-hover.png'), fullPage: false });

await page.click('.scoreboard-table .sb-link.sb-measure');
await page.waitForSelector('.pw-hier-seg.active', { timeout: 20000 });
await page.waitForFunction(() => {
  const active = document.querySelector('.pw-hier-seg.active');
  return active && active.textContent.includes('Lead Measure');
}, { timeout: 20000 });
await new Promise(r => setTimeout(r, 700));
await page.screenshot({ path: path.join(outDir, 'scoreboard-to-measure.png'), fullPage: false });

await browser.close();
console.log('Scoreboard navigation verified');
