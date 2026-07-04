#!/usr/bin/env node
/** Screenshot AI Insight modal with navigable risk links */
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

const session = JSON.parse(fs.readFileSync('/tmp/4dx-session.json', 'utf8'));
const executablePath = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].find(p => fs.existsSync(p));

async function api(pathname, options = {}) {
  const res = await fetch(`http://127.0.0.1:8000${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${pathname}`);
  return data;
}

const projects = await api('/api/projects');
const project = projects.find(p => (p.wigs || []).length) || projects[0];
const wig = (project.wigs || []).find(w => !w.archived_at) || project.wigs[0];

const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(s => localStorage.setItem('session', JSON.stringify(s)), session);
await page.reload({ waitUntil: 'networkidle0', timeout: 60000 });

for (const btn of await page.$$('.sidebar nav button')) {
  if ((await page.evaluate(el => el.textContent, btn)).includes('Projects')) { await btn.click(); break; }
}
await page.waitForSelector('.pf-card', { timeout: 20000 });
await page.click('.pf-card');
await page.waitForSelector('.pw-insight-btn, .ai-insight-btn, button', { timeout: 30000 });

const insightBtn = await page.$('.pw-insight-btn') || await page.$('[class*="insight"]');
if (insightBtn) await insightBtn.click();
else {
  const buttons = await page.$$('button');
  for (const b of buttons) {
    const t = await page.evaluate(el => el.textContent, b);
    if (t && t.includes('AI Insight')) { await b.click(); break; }
  }
}

await page.waitForSelector('.ai-insight-modal', { timeout: 90000 });
await page.waitForSelector('.ai-risk-link, .ai-insight-risk-card', { timeout: 90000 });
await new Promise(r => setTimeout(r, 600));
await page.screenshot({ path: path.join(outDir, 'ai-insight-risk-links.png'), fullPage: false });
console.log('saved ai-insight-risk-links.png');
await browser.close();
