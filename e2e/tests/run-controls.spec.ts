// Tests for run-screen controls: dry-run mode, stop-button lifecycle,
// failed-run badge, and the destructive-command confirmation dialog cancel path.
import { test, expect } from '@playwright/test';
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
  if (!j) throw new Error(`no per-command fixture job for "${command}"`);
  return j;
}

test('dry-run shows "(dry-run)" in the run title and completes with success', async ({ page }) => {
  const { url } = fixture();
  const j = job('copy');
  await page.goto(url);
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });

  await page.locator(`.run-btn[data-job-id="${j.id}"][data-dry="true"]`).click();

  await expect(page.locator('#run-title')).toContainText('dry-run', { timeout: 5_000 });
  await expect(page.locator('#run-status-badge')).toHaveText('success · exit 0', { timeout: 30_000 });
});

test('stop button is visible when a run starts and hidden once it completes', async ({ page }) => {
  const { url } = fixture();
  const j = job('copy');
  await page.goto(url);
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });

  await page.locator(`.run-btn[data-job-id="${j.id}"][data-dry="false"]`).click();

  // The run screen is shown and #stop-btn is made visible synchronously by startRunFlow.
  await expect(page.locator('[data-screen="run"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#stop-btn')).toBeVisible({ timeout: 5_000 });

  // After the run finishes the poll hides the stop button.
  await expect(page.locator('#run-status-badge')).toHaveText('success · exit 0', { timeout: 30_000 });
  await expect(page.locator('#stop-btn')).toBeHidden();
});

test('a job with a non-existent source path shows the "failed" badge', async ({ page }) => {
  const { url } = fixture();
  await page.goto(url);
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });

  // Create a job whose source does not exist so rclone exits non-zero.
  await page.locator('[data-nav="jobs"]').click();
  await page.locator('#new-job-btn').click();
  await expect(page.locator('[data-screen="jobform"]')).toBeVisible({ timeout: 5_000 });
  await page.fill('#f-name', 'E2E Fail Test Job');
  await page.fill('#f-spath', '/nonexistent/e2e-test-src-path');
  await page.fill('#f-dpath', '/tmp/e2e-fail-dst');
  await page.locator('#save-job-btn').click();
  await expect(page.locator('[data-screen="jobs"]')).toBeVisible({ timeout: 5_000 });

  // Run the job from the dashboard.
  await page.locator('[data-nav="dashboard"]').click();
  const dashRow = page.locator('#dashboard-tbody tr').filter({ hasText: 'E2E Fail Test Job' }).first();
  await dashRow.locator('.run-btn[data-dry="false"]').click();

  await expect(page.locator('#run-status-badge')).toHaveText('failed', { timeout: 30_000 });
});

test('clicking Cancel on the destructive-command confirm dialog returns to the dashboard', async ({ page }) => {
  const { url } = fixture();
  const j = job('sync');
  await page.goto(url);
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });

  // Click Run (not dry-run) on a sync job — this is destructive so the confirm dialog appears.
  await page.locator(`.run-btn[data-job-id="${j.id}"][data-dry="false"]`).click();

  await expect(page.locator('#confirm-box')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#confirm-cmd')).toHaveText('sync');

  // Cancel — should navigate back to the dashboard without running anything.
  await page.locator('#confirm-no').click();
  await expect(page.locator('[data-screen="dashboard"]')).toBeVisible({ timeout: 5_000 });
});
