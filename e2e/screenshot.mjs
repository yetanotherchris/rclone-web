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
await page.waitForSelector('#app:not(.hidden)', { timeout: 10000 });

// Screenshot: Dashboard (shows Queues section)
await page.screenshot({ path: '/tmp/ss-dashboard.png' });

// Screenshot: Queues list
await page.locator('[data-nav="queues"]').click();
await page.waitForSelector('#queues-tbody tr', { timeout: 5000 });
await page.screenshot({ path: '/tmp/ss-queues-list.png' });

// Screenshot: Queue form (new)
await page.locator('#new-queue-btn').click();
await page.waitForSelector('[data-screen="queueform"]:not(.hidden)', { timeout: 3000 });
await page.screenshot({ path: '/tmp/ss-queue-form.png' });

// Go back and run the queue
await page.locator('[data-nav="queues"]').click();
await page.waitForSelector('#queues-tbody tr', { timeout: 5000 });
await page.locator('#queues-tbody .run-queue-btn').first().click();
await page.waitForSelector('[data-screen="queuerun"]:not(.hidden)', { timeout: 5000 });
// Wait briefly for some progress
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/ss-queue-run.png' });

// Wait for completion
await page.waitForFunction(
  () => document.getElementById('queuerun-status-badge')?.textContent?.includes('success'),
  { timeout: 20000 }
);
await page.screenshot({ path: '/tmp/ss-queue-run-done.png' });

// Click View logs on first job
const viewLogsBtns = await page.locator('.view-logs-btn').all();
if (viewLogsBtns.length > 0) {
  await viewLogsBtns[0].click();
  await page.waitForSelector('[data-screen="queuelogs"]:not(.hidden)', { timeout: 3000 });
  await page.screenshot({ path: '/tmp/ss-queue-logs.png' });
}

await browser.close();
server.kill();
console.log('Screenshots saved to /tmp/ss-*.png');
