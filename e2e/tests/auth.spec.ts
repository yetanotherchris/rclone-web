// Tests for the lock/unlock flow — these spin up a separate server instance
// WITHOUT --key-file so the app starts locked. They are independent of the
// key-file server managed by global-setup.
import { test, expect } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const FIXTURE_PATH = path.join(__dirname, '../.fixture.json');
const SERVER_BIN = path.join(__dirname, '../.server');

function fixture() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'));
}

function passphrase(): string {
  const { passphrasePath } = fixture();
  return fs.readFileSync(passphrasePath, 'utf-8').trim();
}

async function startLockedServer(configPath: string): Promise<{ url: string; server: ChildProcess }> {
  const server = spawn(SERVER_BIN, [
    '--config', configPath,
    '--port', '0',
    '--bind', '127.0.0.1',
  ]);

  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not start within 15s')), 15_000);
    server.stdout!.on('data', (data: Buffer) => {
      const m = data.toString().match(/listening on (http:\/\/\S+)/);
      if (m) { clearTimeout(timeout); resolve(m[1]); }
    });
    server.stderr!.on('data', (data: Buffer) => {
      process.stderr.write('[auth-server] ' + data.toString());
    });
    server.on('error', (err) => { clearTimeout(timeout); reject(err); });
  });

  return { url, server };
}

test('lock screen is shown when server is not in key-file mode', async ({ page }) => {
  const { configPath } = fixture();
  const { url, server } = await startLockedServer(configPath);
  try {
    await page.goto(url);
    await expect(page.locator('#lock')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#app')).toBeHidden();
  } finally {
    server.kill();
  }
});

test('incorrect password shows an error message', async ({ page }) => {
  const { configPath } = fixture();
  const { url, server } = await startLockedServer(configPath);
  try {
    await page.goto(url);
    await expect(page.locator('#lock')).toBeVisible({ timeout: 10_000 });
    await page.fill('#full-input', 'totally-wrong-password');
    await page.locator('#unlock-btn').click();
    await expect(page.locator('#lock-error')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#lock-error')).toContainText('invalid password');
    // App should remain hidden
    await expect(page.locator('#app')).toBeHidden();
  } finally {
    server.kill();
  }
});

test('correct password unlocks and shows the dashboard', async ({ page }) => {
  const { configPath } = fixture();
  const { url, server } = await startLockedServer(configPath);
  try {
    await page.goto(url);
    await expect(page.locator('#lock')).toBeVisible({ timeout: 10_000 });
    await page.fill('#full-input', passphrase());
    await page.locator('#unlock-btn').click();
    await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#lock')).toBeHidden();
    await expect(page.locator('[data-screen="dashboard"]')).toBeVisible();
  } finally {
    server.kill();
  }
});

test('lock button locks the app and shows the lock screen again', async ({ page }) => {
  const { configPath } = fixture();
  const { url, server } = await startLockedServer(configPath);
  try {
    await page.goto(url);
    // Unlock first
    await expect(page.locator('#lock')).toBeVisible({ timeout: 10_000 });
    await page.fill('#full-input', passphrase());
    await page.locator('#unlock-btn').click();
    await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });
    // Now lock via the sidebar button
    await page.locator('#lock-btn').click();
    await expect(page.locator('#lock')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#app')).toBeHidden();
  } finally {
    server.kill();
  }
});
