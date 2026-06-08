// screenshot.mjs — run with: node screenshot.mjs (from e2e/)
import { chromium } from '@playwright/test';
import { spawn } from 'child_process';
import { execSync } from 'child_process';
import { join } from 'path';

const REPO = new URL('..', import.meta.url).pathname;

const fixture = JSON.parse(
  execSync(join(REPO, 'e2e/.fixtures'), { cwd: REPO }).toString().trim()
);

const server = spawn(join(REPO, 'e2e/.server'), [
  '--config', fixture.configPath,
  '--key-file', fixture.passphrasePath,
  '--port', '0', '--bind', '127.0.0.1',
]);
const url = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('Server timeout')), 15000);
  server.stdout.on('data', d => {
    const m = d.toString().match(/listening on (http:\/\/\S+)/);
    if (m) { clearTimeout(t); resolve(m[1]); }
  });
});

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(url);

// Navigate to Providers and open "New provider" form
await page.click('text=Providers');
await page.waitForSelector('#providers-grid');
await page.click('text=New provider');
await page.waitForSelector('#p-type');

// Select crypt type
await page.selectOption('#p-type', 'crypt');
await page.waitForTimeout(300);

// Screenshot: crypt provider form showing password fields with eye icons
await page.screenshot({ path: '/tmp/crypt-password-fields.png', fullPage: false });

// Now try to save without a password to verify validation
await page.fill('#p-name', 'test-crypt');
await page.click('#save-prov-btn');
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/crypt-password-validation.png', fullPage: false });

await browser.close();
server.kill();
