import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const FIXTURE_PATH = path.join(__dirname, '../.fixture.json');

function fixture() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'));
}

test('queues nav item is visible', async ({ page }) => {
  const { url } = fixture();
  await page.goto(url);
  await expect(page.locator('[data-nav="queues"]')).toBeVisible({ timeout: 10_000 });
});

test('queues list shows E2E Queue', async ({ page }) => {
  const { url } = fixture();
  await page.goto(url);
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-nav="queues"]').click();
  await expect(page.locator('#queues-tbody').getByText('E2E Queue')).toBeVisible({ timeout: 5_000 });
});

test('queue runs and both destinations are populated', async ({ page }) => {
  const { url, queueDst1, queueDst2 } = fixture();
  await page.goto(url);
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });

  // Navigate to queues
  await page.locator('[data-nav="queues"]').click();
  await expect(page.locator('#queues-tbody').getByText('E2E Queue')).toBeVisible({ timeout: 5_000 });

  // Click the Run button for the E2E Queue
  await page.locator('#queues-tbody .run-queue-btn').first().click();

  // Should navigate to queue run screen
  await expect(page.locator('[data-screen="queuerun"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#queuerun-title')).toHaveText('E2E Queue');

  // Wait for the queue run to complete (success)
  await expect(page.locator('#queuerun-status-badge')).toHaveText('✓ success', {
    timeout: 30_000,
  });

  // Verify files were copied to both destinations
  expect(fs.existsSync(path.join(queueDst1, 'hello.txt'))).toBe(true);
  expect(fs.existsSync(path.join(queueDst1, 'world.txt'))).toBe(true);
  expect(fs.existsSync(path.join(queueDst2, 'hello.txt'))).toBe(true);
  expect(fs.existsSync(path.join(queueDst2, 'world.txt'))).toBe(true);
});

test('queue run detail shows job statuses', async ({ page }) => {
  const { url } = fixture();
  await page.goto(url);
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });

  await page.locator('[data-nav="queues"]').click();
  await expect(page.locator('#queues-tbody').getByText('E2E Queue')).toBeVisible({ timeout: 5_000 });
  await page.locator('#queues-tbody .run-queue-btn').first().click();

  await expect(page.locator('[data-screen="queuerun"]')).toBeVisible({ timeout: 5_000 });

  // Wait for completion
  await expect(page.locator('#queuerun-status-badge')).toHaveText('✓ success', {
    timeout: 30_000,
  });

  // Both job rows should show success
  const rows = page.locator('#queuerun-tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('td').nth(0)).toHaveText('Queue Copy 1');
  await expect(rows.nth(0).locator('td').nth(1)).toContainText('success');
  await expect(rows.nth(1).locator('td').nth(0)).toHaveText('Queue Copy 2');
  await expect(rows.nth(1).locator('td').nth(1)).toContainText('success');
});

test('can create and delete a queue', async ({ page }) => {
  const { url } = fixture();
  await page.goto(url);
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });

  await page.locator('[data-nav="queues"]').click();
  await page.locator('#new-queue-btn').click();

  await expect(page.locator('[data-screen="queueform"]')).toBeVisible({ timeout: 5_000 });

  // Fill in the form
  await page.fill('#qf-name', 'Temp Test Queue');

  // Add a job
  await page.selectOption('#qf-add-job-select', { index: 1 });
  await page.locator('#qf-add-job-btn').click();

  await page.locator('#save-queue-btn').click();

  // Should be back on the queues list
  await expect(page.locator('[data-screen="queues"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('Temp Test Queue')).toBeVisible();

  // Delete the queue we just created
  const rows = page.locator('#queues-tbody tr');
  const newRow = rows.filter({ hasText: 'Temp Test Queue' });
  page.once('dialog', dialog => dialog.accept());
  await newRow.locator('.delete-queue-btn').click();

  await expect(page.getByText('Temp Test Queue')).toBeHidden({ timeout: 5_000 });
});
