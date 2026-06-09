// Tests for advanced queue features: on_failure policy display, queue run
// stop-button lifecycle, and the queue-logs viewer.
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const FIXTURE_PATH = path.join(__dirname, '../.fixture.json');

function fixture() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'));
}

test('queue created with stop-on-first-failure shows the policy in the list', async ({ page }) => {
  const { url } = fixture();
  await page.goto(url);
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });

  await page.locator('[data-nav="queues"]').click();
  await page.locator('#new-queue-btn').click();
  await expect(page.locator('[data-screen="queueform"]')).toBeVisible({ timeout: 5_000 });

  await page.fill('#qf-name', 'E2E Stop On Failure Queue');
  // The checkbox is "Continue on failure" — uncheck it to enable stop-on-failure.
  await page.locator('#qf-on-failure').uncheck();
  await page.locator('#save-queue-btn').click();

  await expect(page.locator('[data-screen="queues"]')).toBeVisible({ timeout: 5_000 });
  const row = page.locator('#queues-tbody tr').filter({ hasText: 'E2E Stop On Failure Queue' });
  await expect(row).toBeVisible({ timeout: 5_000 });
  await expect(row).toContainText('Stop on first failure');
});

test('queue run stop button is hidden once the queue completes', async ({ page }) => {
  const { url } = fixture();
  await page.goto(url);
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });

  await page.locator('[data-nav="queues"]').click();
  await expect(page.locator('#queues-tbody').getByText('E2E Queue')).toBeVisible({ timeout: 5_000 });

  await page.locator('#queues-tbody .run-queue-btn').first().click();
  await expect(page.locator('[data-screen="queuerun"]')).toBeVisible({ timeout: 5_000 });

  // Wait for the queue to finish.
  await expect(page.locator('#queuerun-status-badge')).toHaveText('✓ success', { timeout: 30_000 });

  // renderQueueRunDetail hides the stop button when status !== 'running'.
  await expect(page.locator('#queuerun-stop-btn')).toBeHidden();
});

test('queue logs viewer is accessible from the queue run detail and shows the job selector', async ({ page }) => {
  const { url } = fixture();
  await page.goto(url);
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });

  await page.locator('[data-nav="queues"]').click();
  await expect(page.locator('#queues-tbody').getByText('E2E Queue')).toBeVisible({ timeout: 5_000 });

  // Run the E2E Queue and wait for completion.
  await page.locator('#queues-tbody .run-queue-btn').first().click();
  await expect(page.locator('[data-screen="queuerun"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#queuerun-status-badge')).toHaveText('✓ success', { timeout: 30_000 });

  // Click "View logs" for the first job in the queue run.
  await page.locator('#queuerun-tbody .view-logs-btn').first().click();

  // Should navigate to the queue logs screen.
  await expect(page.locator('[data-screen="queuelogs"]')).toBeVisible({ timeout: 5_000 });

  // The back-link should name the queue.
  await expect(page.locator('#queuelogs-back-title')).toHaveText('E2E Queue');

  // The job selector should be populated with the two queue jobs.
  const options = page.locator('#queuelogs-job-select option');
  await expect(options).toHaveCount(2, { timeout: 5_000 });

  // The first option should correspond to Queue Copy 1.
  await expect(options.first()).toContainText('Queue Copy 1');
});
