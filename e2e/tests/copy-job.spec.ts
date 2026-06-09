import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const FIXTURE_PATH = path.join(__dirname, '../.fixture.json');

function fixture() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'));
}

test('app is unlocked in key-file mode — no lock screen', async ({ page }) => {
  const { url } = fixture();
  await page.goto(url);
  // Dashboard becomes visible once checkStatus() resolves to locked=false
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#lock')).toBeHidden();
});

test('dashboard lists the E2E Copy job', async ({ page }) => {
  const { url } = fixture();
  await page.goto(url);
  await expect(page.getByText('E2E Copy')).toBeVisible({ timeout: 10_000 });
});

test('can clone a job', async ({ page }) => {
  const { url } = fixture();
  await page.goto(url);
  await page.locator('[data-nav="jobs"]').click();
  await expect(page.locator('#jobs-tbody').getByText('E2E Copy')).toBeVisible({ timeout: 10_000 });

  const row = page.locator('#jobs-tbody tr').filter({ hasText: 'E2E Copy' }).first();
  await row.locator('.clone-job-btn').click();

  await expect(page.locator('#jobs-tbody').getByText('E2E Copy Clone')).toBeVisible({ timeout: 5_000 });
});

test('can edit a job', async ({ page }) => {
  const { url } = fixture();
  await page.goto(url);
  await page.locator('[data-nav="jobs"]').click();
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });

  // Create a job to edit
  await page.locator('#new-job-btn').click();
  await expect(page.locator('[data-screen="jobform"]')).toBeVisible({ timeout: 5_000 });
  await page.fill('#f-name', 'Temp Edit Job');
  await page.locator('#save-job-btn').click();
  await expect(page.locator('[data-screen="jobs"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#jobs-tbody').getByText('Temp Edit Job')).toBeVisible();

  // Edit it
  const row = page.locator('#jobs-tbody tr').filter({ hasText: 'Temp Edit Job' });
  await row.locator('.edit-job-btn').click();
  await expect(page.locator('[data-screen="jobform"]')).toBeVisible({ timeout: 5_000 });
  await page.fill('#f-name', 'Temp Edit Job Updated');
  await page.locator('#save-job-btn').click();

  await expect(page.locator('[data-screen="jobs"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#jobs-tbody').getByText('Temp Edit Job Updated', { exact: true })).toBeVisible();
  await expect(page.locator('#jobs-tbody').getByText('Temp Edit Job', { exact: true })).toHaveCount(0);
});

test('can delete a job', async ({ page }) => {
  const { url } = fixture();
  await page.goto(url);
  await page.locator('[data-nav="jobs"]').click();
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });

  // Create a job to delete
  await page.locator('#new-job-btn').click();
  await expect(page.locator('[data-screen="jobform"]')).toBeVisible({ timeout: 5_000 });
  await page.fill('#f-name', 'Temp Delete Job');
  await page.locator('#save-job-btn').click();
  await expect(page.locator('[data-screen="jobs"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#jobs-tbody').getByText('Temp Delete Job')).toBeVisible();

  // Delete it
  const row = page.locator('#jobs-tbody tr').filter({ hasText: 'Temp Delete Job' });
  page.once('dialog', dialog => dialog.accept());
  await row.locator('.delete-job-btn').click();

  await expect(page.locator('#jobs-tbody').getByText('Temp Delete Job')).toHaveCount(0, { timeout: 5_000 });
});

test('copy job runs and files appear in destination', async ({ page }) => {
  const { url, dstDir } = fixture();
  await page.goto(url);

  // Wait for the job row to be rendered
  await expect(page.getByText('E2E Copy', { exact: true })).toBeVisible({ timeout: 10_000 });

  // Click the Run button (not Dry-run) on the first job
  await page.locator('.run-btn[data-dry="false"]').first().click();

  // The run screen appears; copy is not destructive so no confirm dialog
  // Wait for the job to complete
  await expect(page.locator('#run-status-badge')).toHaveText('success · exit 0', {
    timeout: 30_000,
  });

  // Verify files were copied to the destination directory
  expect(fs.existsSync(path.join(dstDir, 'hello.txt'))).toBe(true);
  expect(fs.existsSync(path.join(dstDir, 'world.txt'))).toBe(true);
  expect(fs.readFileSync(path.join(dstDir, 'hello.txt'), 'utf-8')).toBe(
    'hello from rclone-web e2e\n',
  );
});
