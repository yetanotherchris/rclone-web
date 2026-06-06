import { chromium } from '@playwright/test';
import { spawn } from 'child_process';
import { execSync } from 'child_process';

const REPO = '/home/user/rclone-web';
const fixture = JSON.parse(execSync(`${REPO}/e2e/.fixtures`, { cwd: REPO }).toString().trim());

const server = spawn(`${REPO}/e2e/.server`, [
  '--config', fixture.configPath,
  '--key-file', fixture.passphrasePath,
  '--port', '0', '--bind', '127.0.0.1',
]);
const url = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timeout')), 15000);
  server.stdout.on('data', d => {
    const m = d.toString().match(/listening on (http:\/\/\S+)/);
    if (m) { clearTimeout(t); resolve(m[1]); }
  });
});

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(url);

// Wait for the app JS to render (dashboard section becomes visible)
await page.waitForSelector('[data-screen="dashboard"]:not(.hidden)', { timeout: 10000 });

// Screenshot 1: sidebar nav
await page.screenshot({ path: '/tmp/ss-nav.png' });

// Screenshot 2: queue form with checkbox and drag handles
await page.click('[data-nav="queues"]');
await page.waitForSelector('[data-screen="queues"]:not(.hidden)');
await page.click('#new-queue-btn');
await page.waitForSelector('[data-screen="queueform"]:not(.hidden)');

// Add two jobs so the drag handle is visible
const sel = page.locator('#qf-add-job-select');
const opts = await sel.locator('option').all();
if (opts.length > 1) {
  await sel.selectOption({ index: 1 });
  await page.click('#qf-add-job-btn');
}
if (opts.length > 2) {
  await sel.selectOption({ index: 2 });
  await page.click('#qf-add-job-btn');
}

await page.screenshot({ path: '/tmp/ss-queueform.png' });

await browser.close();
server.kill();
console.log('done');
