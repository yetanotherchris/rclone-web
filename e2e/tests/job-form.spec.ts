// Tests for the job form: one-sided-command destination hiding, live command
// preview updates, extra-args flag insertion, and name-required validation.
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const FIXTURE_PATH = path.join(__dirname, '../.fixture.json');

function fixture() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'));
}

test('selecting lsf hides destination fields; switching back to copy shows them', async ({ page }) => {
  const { url } = fixture();
  await page.goto(url);
  await page.locator('[data-nav="jobs"]').click();
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });

  await page.locator('#new-job-btn').click();
  await expect(page.locator('[data-screen="jobform"]')).toBeVisible({ timeout: 5_000 });

  // Default command (copy): both destination fields are visible.
  await expect(page.locator('#dest-prov-field')).toBeVisible();
  await expect(page.locator('#dest-path-field')).toBeVisible();

  // Switch to lsf — one-sided, no destination needed.
  await page.selectOption('#f-cmd', 'lsf');
  await expect(page.locator('#dest-prov-field')).toBeHidden();
  await expect(page.locator('#dest-path-field')).toBeHidden();

  // Switch back to copy — destination fields reappear.
  await page.selectOption('#f-cmd', 'copy');
  await expect(page.locator('#dest-prov-field')).toBeVisible();
  await expect(page.locator('#dest-path-field')).toBeVisible();
});

test('command preview updates as source path, destination path, and command change', async ({ page }) => {
  const { url } = fixture();
  await page.goto(url);
  await page.locator('[data-nav="jobs"]').click();
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });

  await page.locator('#new-job-btn').click();
  await expect(page.locator('[data-screen="jobform"]')).toBeVisible({ timeout: 5_000 });

  await page.fill('#f-spath', '/tmp/e2e-src');
  await page.fill('#f-dpath', '/tmp/e2e-dst');

  const preview = page.locator('#cmd-preview');
  await expect(preview).toContainText('rclone copy');
  await expect(preview).toContainText('/tmp/e2e-src');
  await expect(preview).toContainText('/tmp/e2e-dst');

  // Changing the command updates the preview.
  await page.selectOption('#f-cmd', 'sync');
  await expect(preview).toContainText('rclone sync');
});

test('extra args typed on the Advanced tab appear in the command preview', async ({ page }) => {
  const { url } = fixture();
  await page.goto(url);
  await page.locator('[data-nav="jobs"]').click();
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });

  await page.locator('#new-job-btn').click();
  await expect(page.locator('[data-screen="jobform"]')).toBeVisible({ timeout: 5_000 });

  await page.fill('#f-spath', '/tmp/e2e-src');
  await page.fill('#f-dpath', '/tmp/e2e-dst');

  // Switch to the Advanced tab to access the extra-args textarea.
  await page.locator('.job-tab-btn[data-tab="advanced"]').click();
  await page.fill('#f-extra', '--dry-run --checksum');

  // cmd-preview lives in the Details tab but is always in the DOM — its text
  // is updated by the 'input' event even when the element is visually hidden.
  await expect(page.locator('#cmd-preview')).toContainText('--dry-run --checksum');
});

test('saving a job without a name shows a "Name is required" error', async ({ page }) => {
  const { url } = fixture();
  await page.goto(url);
  await page.locator('[data-nav="jobs"]').click();
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });

  await page.locator('#new-job-btn').click();
  await expect(page.locator('[data-screen="jobform"]')).toBeVisible({ timeout: 5_000 });

  // Leave the name field empty and attempt to save.
  await page.locator('#save-job-btn').click();

  await expect(page.locator('#jobform-error')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#jobform-error')).toContainText('Name is required');
  // The form stays open — no navigation away.
  await expect(page.locator('[data-screen="jobform"]')).toBeVisible();
});
