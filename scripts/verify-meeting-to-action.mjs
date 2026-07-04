import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

const session = JSON.parse(fs.readFileSync('/tmp/4dx-session.json', 'utf8'));
const token = session.token;
const executablePath = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].find(p => fs.existsSync(p));

const sampleNotes = `Belagavi Water Supply — WIG session with CM on 3 July 2026.

CM asked the project team to hold a tripartite meeting with BWSSB and contractor on July 12 to resolve pipeline land disputes. PD agreed to schedule and send invites by July 8.

Progress report on 24x7 water supply coverage due in 2 weeks — prepared by Priya and submitted to CM office.

Road restoration works have seen scope creep beyond original BOQ. PM must review scope with finance and revert with revised estimates before next cadence.

Follow up with district collector on land acquisition for booster pump station.`;

async function api(pathname, options = {}) {
  const res = await fetch(`http://127.0.0.1:8000${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${res.status} ${pathname}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}

async function clickSidebarNav(page, label) {
  for (const btn of await page.$$('.sidebar nav button')) {
    if ((await page.evaluate(el => el.textContent, btn)).includes(label)) {
      await btn.click();
      return;
    }
  }
  throw new Error(`Sidebar nav item not found: ${label}`);
}

async function closeMtaModal(page) {
  const closeBtn = await page.$('.mta-modal-head .icon-btn');
  if (closeBtn) await closeBtn.click();
  await page.waitForFunction(() => !document.querySelector('.mta-modal'), { timeout: 5000 });
}

const projects = await api('/api/projects');
const projectId = projects[0]?._id;
const ministryId = projects[0]?.ministry_id;
if (!projectId || !ministryId) throw new Error('No projects with ministry found');

const projectPreview = await api(`/api/projects/${projectId}/meeting-to-action/parse`, {
  method: 'POST',
  body: JSON.stringify({ notes: sampleNotes, ministry_id: ministryId }),
});
console.log('project parse status:', projectPreview.llm_status);
console.log('project wigs:', projectPreview.proposed_wigs?.length, 'measures:', projectPreview.proposed_measures?.length, 'actions:', projectPreview.proposed_actions?.length);

const ministryPreview = await api(`/api/ministries/${ministryId}/meeting-to-action/parse`, {
  method: 'POST',
  body: JSON.stringify({ notes: sampleNotes, ministry_id: ministryId }),
});
console.log('ministry parse status:', ministryPreview.llm_status);
console.log('ministry wigs:', ministryPreview.proposed_wigs?.length, 'measures:', ministryPreview.proposed_measures?.length, 'actions:', ministryPreview.proposed_actions?.length);
if (ministryPreview.project_id) {
  throw new Error('Ministry parse should not pin a single project_id on the preview');
}

const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate((s) => localStorage.setItem('session', JSON.stringify(s)), session);
await page.reload({ waitUntil: 'networkidle0', timeout: 60000 });

// Project workspace entry: scope locked, no pickers
await clickSidebarNav(page, 'Projects');
await page.waitForSelector('.pf-card', { timeout: 20000 });
await page.click('.pf-card');
await page.waitForSelector('.pw-hero', { timeout: 30000 });
await page.click('.pw-hero-actions .mta-btn');
await page.waitForSelector('.mta-modal', { timeout: 10000 });

const workspaceHasMinistrySelect = await page.$('[data-testid="mta-ministry-select"]');
const workspaceHasProjectSelect = await page.$('[data-testid="mta-project-select"]');
if (workspaceHasMinistrySelect || workspaceHasProjectSelect) {
  throw new Error('Project-level MTA should not show ministry/project selects');
}
await page.waitForSelector('[data-testid="mta-scope-context"]', { timeout: 5000 });
const notesDisabled = await page.$eval('.mta-notes textarea', el => el.disabled);
if (notesDisabled) throw new Error('Notes textarea should be enabled in project workspace MTA');
console.log('project workspace scope: PASS (context chip, no pickers, notes enabled)');

await page.evaluate((text) => {
  const el = document.querySelector('.mta-notes textarea');
  if (!el) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(el, text);
  else el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, sampleNotes);
await page.waitForFunction(() => {
  const btn = document.querySelector('.mta-toolbar .primary-btn');
  return btn && !btn.disabled;
}, { timeout: 5000 });
await page.click('.mta-toolbar .primary-btn');
await page.waitForFunction(
  () => document.querySelector('.mta-preview .mta-card') || document.querySelector('.mta-modal-body .ai-error'),
  { timeout: 180000 },
);
const analyzeError = await page.$('.mta-modal-body .ai-error');
if (analyzeError) {
  const msg = await page.evaluate(el => el.textContent, analyzeError);
  throw new Error(`Analyze failed in project workspace MTA: ${msg}`);
}
const workspaceActionProjectSelects = await page.$$('[data-testid="mta-action-project-select"]');
if (workspaceActionProjectSelects.length > 0) {
  throw new Error('Project workspace MTA should not show per-action project selects');
}
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: path.join(outDir, 'meeting-to-action-assoc-preview.png'), fullPage: false });
console.log('saved meeting-to-action-assoc-preview.png');

// Review step: Apply → review → back → apply → approve
await page.click('[data-testid="mta-apply-btn"]');
await page.waitForSelector('[data-testid="mta-review"]', { timeout: 10000 });
const reviewVisible = await page.$eval('[data-testid="mta-review"]', el => !!el);
if (!reviewVisible) throw new Error('Review panel should appear after Apply selected');
await page.screenshot({ path: path.join(outDir, 'meeting-to-action-review.png'), fullPage: false });
console.log('saved meeting-to-action-review.png');

await page.click('[data-testid="mta-review-back"]');
await page.waitForSelector('.mta-preview .mta-card', { timeout: 5000 });
const backToPreview = await page.$('.mta-preview .mta-card');
if (!backToPreview) throw new Error('Back to editing should restore preview cards');
console.log('review back to editing: PASS');

await page.click('[data-testid="mta-apply-btn"]');
await page.waitForSelector('[data-testid="mta-review"]', { timeout: 10000 });
await page.click('[data-testid="mta-review-approve"]');
await page.waitForFunction(() => !document.querySelector('.mta-modal'), { timeout: 120000 });
console.log('review approve + modal close: PASS');

await closeMtaModal(page).catch(() => {});

// Return to portfolio list before opening portfolio-level MTA
await page.click('.pw-back-btn');
await page.waitForSelector('.pf-head .mta-btn', { timeout: 10000 });

// Portfolio list entry: ministry picker only before notes
await page.click('.pf-head .mta-btn');
await page.waitForSelector('.mta-modal', { timeout: 10000 });

const portfolioHasMinistrySelect = await page.$('[data-testid="mta-ministry-select"]');
const portfolioHasProjectSelect = await page.$('[data-testid="mta-project-select"]');
const portfolioHasContextChip = await page.$('[data-testid="mta-scope-context"]');
if (!portfolioHasMinistrySelect) {
  throw new Error('Portfolio-level MTA should show ministry select');
}
if (portfolioHasProjectSelect) {
  throw new Error('Portfolio-level MTA should not show pre-notes project select');
}
if (portfolioHasContextChip) {
  throw new Error('Portfolio-level MTA should not show locked scope context chip');
}
const portfolioNotesDisabled = await page.$eval('.mta-notes textarea', el => el.disabled);
if (!portfolioNotesDisabled) throw new Error('Notes textarea should stay disabled until ministry is selected');
console.log('portfolio list scope: PASS (ministry picker only, notes disabled until ministry)');

await page.select('[data-testid="mta-ministry-select"]', ministryId);
const portfolioNotesEnabled = await page.$eval('.mta-notes textarea', el => !el.disabled);
if (!portfolioNotesEnabled) throw new Error('Notes textarea should enable after ministry selection');
console.log('portfolio ministry selection: PASS');

await page.evaluate((text) => {
  const el = document.querySelector('.mta-notes textarea');
  if (!el) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(el, text);
  else el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, sampleNotes);
await page.waitForFunction(() => {
  const btn = document.querySelector('.mta-toolbar .primary-btn');
  return btn && !btn.disabled;
}, { timeout: 5000 });
await page.click('.mta-toolbar .primary-btn');
await page.waitForFunction(
  () => document.querySelector('.mta-preview .mta-card') || document.querySelector('.mta-modal-body .ai-error'),
  { timeout: 180000 },
);
const portfolioAnalyzeError = await page.$('.mta-modal-body .ai-error');
if (portfolioAnalyzeError) {
  const msg = await page.evaluate(el => el.textContent, portfolioAnalyzeError);
  throw new Error(`Analyze failed in portfolio MTA: ${msg}`);
}
const portfolioActionProjectSelects = await page.$$('[data-testid="mta-action-project-select"]');
if (portfolioActionProjectSelects.length === 0) {
  throw new Error('Portfolio MTA preview should show per-item project selects after analyze');
}
console.log('portfolio analyze + action project selects: PASS');

await closeMtaModal(page);

const stampedPreview = {
  ...ministryPreview,
  proposed_wigs: (ministryPreview.proposed_wigs || []).map(item => ({ ...item, project_id: projectId })),
  proposed_measures: (ministryPreview.proposed_measures || []).map(item => ({ ...item, project_id: projectId })),
  proposed_actions: (ministryPreview.proposed_actions || []).map(item => ({ ...item, project_id: projectId })),
};

const applyResult = await api(`/api/ministries/${ministryId}/meeting-to-action/apply`, {
  method: 'POST',
  body: JSON.stringify({
    ministry_id: ministryId,
    proposed_wigs: stampedPreview.proposed_wigs || [],
    proposed_measures: stampedPreview.proposed_measures || [],
    proposed_actions: stampedPreview.proposed_actions || [],
  }),
});
console.log('ministry apply:', applyResult.status, applyResult.created_wigs, applyResult.created_measures, applyResult.comments_posted, applyResult.assignments_created, 'projects_updated:', applyResult.projects_updated);

await browser.close();
console.log('verify-meeting-to-action: PASS');
