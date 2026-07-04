import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const API = 'http://127.0.0.1:8000';
const APP = 'http://127.0.0.1:5173';

async function login(phone) {
  const otpRes = await fetch(`${API}/api/auth/request-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  }).then(r => r.json());
  const auth = await fetch(`${API}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, otp: otpRes.demo_otp }),
  }).then(r => r.json());
  return auth;
}

const settings = await fetch(`${API}/api/public/settings`).then(r => r.json());
console.log('demo_admin_phones:', settings.demo_admin_phones);

const adminAuth = await login('9999900000');
console.log('admin role:', adminAuth.user?.role);
if (adminAuth.user?.role !== 'admin') throw new Error('Expected admin role for 9999900000');

const userAuth = await login('1234567890');
console.log('user role:', userAuth.user?.role);
if (userAuth.user?.role !== 'user') throw new Error('Expected user role for 1234567890');

const me = await fetch(`${API}/api/auth/me`, {
  headers: { Authorization: `Bearer ${adminAuth.token}` },
}).then(r => r.json());
console.log('auth/me role:', me.user?.role);

const executablePath = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].find(p => fs.existsSync(p));

const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

await page.goto(APP, { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate((s) => localStorage.setItem('session', JSON.stringify(s)), adminAuth);
await page.reload({ waitUntil: 'networkidle0', timeout: 60000 });

const navLabels = await page.$$eval('.sidebar nav button span', els => els.map(el => el.textContent.trim()));
console.log('sidebar items:', navLabels.join(', '));
if (!navLabels.some(t => /admin/i.test(t))) throw new Error('Admin nav missing for admin session');

await page.setViewport({ width: 390, height: 844 });
await page.click('.menu-btn');
await page.waitForSelector('.app-shell.sidebar-open');
const mobileNav = await page.$$eval('.sidebar nav button span', els => els.map(el => el.textContent.trim()));
console.log('mobile sidebar items:', mobileNav.join(', '));
if (!mobileNav.some(t => /admin/i.test(t))) throw new Error('Admin nav missing on mobile');

await browser.close();
console.log('verify-admin-nav: OK');
