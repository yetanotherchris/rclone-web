import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const FIXTURE_PATH = path.join(__dirname, '../.fixture.json');

interface CmdJob {
  id: string;
  name: string;
  command: string;
  srcDir: string;
  dstDir?: string;
  destructive: boolean;
}

function fixture() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'));
}

function job(command: string): CmdJob {
  const j = fixture().commandJobs.find((c: CmdJob) => c.command === command);
  if (!j) throw new Error(`no per-command job for command "${command}"`);
  return j;
}

// Run a per-command job from the UI (handling the confirm dialog for
// destructive commands) and wait for it to finish successfully.
async function runToSuccess(page: Page, url: string, j: CmdJob): Promise<void> {
  await page.goto(url);
  await page.locator(`.run-btn[data-job-id="${j.id}"][data-dry="false"]`).click();
  if (j.destructive) {
    // sync/move pop a confirm dialog before the run starts.
    await expect(page.locator('#confirm-box')).toBeVisible();
    await page.locator('#confirm-yes').click();
  }
  await expect(page.locator('#run-status-badge')).toHaveText('success · exit 0', {
    timeout: 30_000,
  });
}

test('copy: transfers files and the run log shows them copied', async ({ page }) => {
  const { url } = fixture();
  const j = job('copy');
  await runToSuccess(page, url, j);

  expect(fs.existsSync(path.join(j.dstDir!, 'hello.txt'))).toBe(true);
  expect(fs.existsSync(path.join(j.dstDir!, 'world.txt'))).toBe(true);

  // Job runs with -v, so the log names the transferred file and "Copied".
  await expect(page.locator('#run-log')).toContainText('hello.txt');
  await expect(page.locator('#run-log')).toContainText('Copied');
});

test('sync: makes the destination mirror the source (deletes extras)', async ({ page }) => {
  const { url } = fixture();
  const j = job('sync');
  await runToSuccess(page, url, j);

  expect(fs.existsSync(path.join(j.dstDir!, 'keep.txt'))).toBe(true);
  expect(fs.existsSync(path.join(j.dstDir!, 'stale.txt'))).toBe(false);
});

test('move: moves files into the destination and empties the source', async ({ page }) => {
  const { url } = fixture();
  const j = job('move');
  await runToSuccess(page, url, j);

  expect(fs.existsSync(path.join(j.dstDir!, 'm1.txt'))).toBe(true);
  expect(fs.existsSync(path.join(j.dstDir!, 'm2.txt'))).toBe(true);
  expect(fs.readdirSync(j.srcDir)).toHaveLength(0);
});

test('check: succeeds when source and destination already match', async ({ page }) => {
  const { url } = fixture();
  const j = job('check');
  // Success badge (exit 0) is the assertion — check is read-only and only exits
  // 0 when the two sides match.
  await runToSuccess(page, url, j);
});

test('lsf: lists the source files in the run log', async ({ page }) => {
  const { url } = fixture();
  const j = job('lsf');
  await runToSuccess(page, url, j);

  await expect(page.locator('#run-log')).toContainText('l1.txt');
  await expect(page.locator('#run-log')).toContainText('l2.txt');
});
