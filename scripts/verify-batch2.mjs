import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const session = JSON.parse(fs.readFileSync('/tmp/4dx-session.json', 'utf8'));
const outDir = path.resolve('screenshots');
fs.mkdirSync(outDir, { recursive: true });

const chromePaths = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];
const executablePath = chromePaths.find(p => fs.existsSync(p));
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

async function clickNav(label) {
  for (const btn of await page.$$('.sidebar nav button')) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text.includes(label)) { await btn.click(); return; }
  }
}

await clickNav('Projects');
await page.waitForSelector('.pf-grid, .pf-card', { timeout: 15000 });

// Open create project modal
await page.click('.primary-btn');
await page.waitForSelector('.entity-modal', { timeout: 10000 });
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: path.join(outDir, 'modal-create-project.png'), fullPage: false });
await page.keyboard.press('Escape');
await new Promise(r => setTimeout(r, 400));

// Open first project workspace
const cards = await page.$$('.pf-grid .pf-card');
if (!cards.length) throw new Error('No project cards found');
await cards[0].click();
await page.waitForFunction(() => document.querySelector('.pw-hero'), { timeout: 20000 });
await new Promise(r => setTimeout(r, 600));
await page.screenshot({ path: path.join(outDir, 'budget-project-workspace.png'), fullPage: false });

// Add WIG modal
const addWig = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Add WIG')));
if (addWig) {
  await addWig.click();
  await page.waitForSelector('.entity-modal', { timeout: 8000 });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: path.join(outDir, 'modal-add-wig.png'), fullPage: false });
  await page.keyboard.press('Escape');
}

// AI Insight budget preset
await clickNav('AI Insight');
await page.waitForSelector('.ai-presets', { timeout: 15000 });
const budgetBtn = await page.evaluateHandle(() => [...document.querySelectorAll('.ai-preset')].find(b => b.textContent.includes('budget')));
if (budgetBtn) {
  await budgetBtn.click();
  await page.waitForSelector('.ai-answer', { timeout: 90000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 800));
}
await page.screenshot({ path: path.join(outDir, 'ai-insight-budget.png'), fullPage: false });

await browser.close();
console.log('screenshots saved');
