import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const sessionPath = '/tmp/4dx-session.json';
const otpRes = await fetch('http://localhost:8000/api/auth/request-otp', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone: '9999900000' }),
}).then(r => r.json());
const verify = await fetch('http://localhost:8000/api/auth/verify-otp', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone: '9999900000', otp: otpRes.demo_otp }),
}).then(r => r.json());
fs.writeFileSync(sessionPath, JSON.stringify(verify));
const session = verify;
const outDir = path.resolve('screenshots');
fs.mkdirSync(outDir, { recursive: true });

const executablePath = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].find(p => fs.existsSync(p));
if (!executablePath) throw new Error('Chrome not found');

const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
await page.evaluate((s) => localStorage.setItem('session', JSON.stringify(s)), session);
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForSelector('.sidebar nav button', { timeout: 20000 });

for (const btn of await page.$$('.sidebar nav button')) {
  if ((await page.evaluate(el => el.textContent, btn)).includes('Projects')) { await btn.click(); break; }
}
await page.waitForSelector('.pf-grid .pf-card', { timeout: 45000 });
const card = await page.evaluateHandle(() =>
  [...document.querySelectorAll('.pf-grid .pf-card')].find(c => /\d+\s+WIGs/.test(c.textContent) && !/0\s+WIGs/.test(c.textContent))
);
await card.click();
await page.waitForSelector('.pw-wig-card', { timeout: 20000 });
await (await page.$('.pw-wig-card')).click();
await page.waitForSelector('.pw-measure-main', { timeout: 15000 });
await (await page.$('.pw-measure-main')).click();
await page.waitForSelector('.pw-composer-textarea', { timeout: 15000 });

await page.click('.pw-segment button:nth-child(2)');
const multiline = 'Status update:\n\n- Site A cleared\n- Site B pending approval\n\nNext: escalate with district office.';
await page.type('.pw-composer-textarea', multiline);
await page.screenshot({ path: path.join(outDir, 'comment-composer-textarea.png') });
await page.click('.pw-composer .primary-btn');
await page.waitForFunction(() => document.querySelector('.pw-event-card p.formatted-text'), { timeout: 20000 });
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: path.join(outDir, 'comment-multiline-timeline.png'), fullPage: false });

// Deadline validation in add measure modal
const addMeasureBtn = await page.evaluateHandle(() =>
  [...document.querySelectorAll('button.primary-btn')].find(b => b.textContent.includes('Add lead measure'))
);
const addEl = addMeasureBtn.asElement();
if (addEl) {
  await addEl.click();
  await page.waitForSelector('.entity-modal input[type="date"]', { timeout: 10000 });
  await page.evaluate(() => {
    const input = document.querySelector('.entity-modal input[type="date"]');
    if (!input) return;
    input.value = '2099-12-31';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: path.join(outDir, 'deadline-validation-error.png') });
}

await browser.close();
console.log('Verification screenshots saved');
