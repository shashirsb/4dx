import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

async function login() {
  const otpRes = await fetch('http://127.0.0.1:8000/api/auth/request-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9999900000' }),
  }).then(r => r.json());
  const verify = await fetch('http://127.0.0.1:8000/api/auth/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9999900000', otp: otpRes.demo_otp }),
  }).then(r => r.json());
  const session = { token: verify.token, user: verify.user };
  fs.writeFileSync('/tmp/4dx-session.json', JSON.stringify(session));
  return session;
}

const session = await login();

const projects = await fetch('http://127.0.0.1:8000/api/projects', {
  headers: { Authorization: `Bearer ${session.token}` },
}).then(r => r.json());
const project = projects.find(p => (p.wigs || []).some(w => !w.archived_at && (w.lead_measures || []).some(m => !m.archived_at))) || projects[0];
const wig = (project.wigs || []).find(w => !w.archived_at);
const measure = wig ? (wig.lead_measures || []).find(m => !m.archived_at) : null;
console.log('project', project.name, 'wig', wig?.title, 'measure', measure?.title);

const executablePath = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].find(p => fs.existsSync(p));

const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate((s) => localStorage.setItem('session', JSON.stringify(s)), session);
await page.reload({ waitUntil: 'networkidle0', timeout: 60000 });

for (const btn of await page.$$('.sidebar nav button')) {
  const text = await page.evaluate(el => el.textContent, btn);
  if (text.includes('Projects')) { await btn.click(); break; }
}
await new Promise(r => setTimeout(r, 1500));
await page.waitForSelector('.pf-card, .empty-state', { timeout: 30000 });
const cards = await page.$$('.pf-card');
if (!cards.length) throw new Error('No project cards found');
await cards[0].click();
await page.waitForSelector('.ai-insight-btn, .pw-wig-card, .empty-state', { timeout: 30000 });

async function openInsightAndShot(name, beforeFn) {
  if (beforeFn) await beforeFn();
  await page.click('.ai-insight-btn');
  await page.waitForSelector('.ai-insight-modal', { timeout: 30000 });
  await page.waitForFunction(() => {
    const loading = document.querySelector('.ai-insight-loading');
    const summary = document.querySelector('.ai-insight-summary p');
    const error = document.querySelector('.ai-insight-modal-body .ai-error');
    return (!loading && ((summary?.textContent?.trim()?.length || 0) > 20 || error)) || false;
  }, { timeout: 180000 });
  await new Promise(r => setTimeout(r, 500));
  const summaryText = await page.$eval('.ai-insight-summary p', el => el.textContent.trim()).catch(() => '');
  console.log(name, 'summary_len:', summaryText.length);
  await page.screenshot({ path: path.join(outDir, name), fullPage: false });
  await page.click('.ai-insight-modal-head .icon-btn');
  await page.waitForFunction(() => !document.querySelector('.ai-insight-modal'), { timeout: 5000 });
}

await openInsightAndShot('contextual-insight-project-fixed.png');

await page.waitForSelector('.pw-wig-card', { timeout: 20000 });
await page.evaluate(() => document.querySelector('.pw-wig-open')?.click());
await page.waitForSelector('.pw-measure-row', { timeout: 20000 });
await openInsightAndShot('contextual-insight-wig-fixed.png');

await page.evaluate(() => document.querySelector('.pw-measure-main')?.click());
await page.waitForSelector('.pw-composer', { timeout: 20000 });
await openInsightAndShot('contextual-insight-measure-fixed.png');

console.log('saved fixed insight screenshots');
await browser.close();
