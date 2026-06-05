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

test('copy job runs and files appear in destination', async ({ page }) => {
  const { url, dstDir } = fixture();
  await page.goto(url);

  // Wait for the job row to be rendered
  await expect(page.getByText('E2E Copy')).toBeVisible({ timeout: 10_000 });

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
