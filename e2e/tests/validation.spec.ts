// Tests for form validation (required-field errors), dashboard queue section,
// dashboard dry-run/run buttons, last-run status display, and custom provider keys.
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const FIXTURE_PATH = path.join(__dirname, '../.fixture.json');

function fixture() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'));
}

test('queue form shows "Name is required" when saved without a name', async ({ page }) => {
  const { url } = fixture();
  await page.goto(url);
  await page.locator('[data-nav="queues"]').click();
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });

  await page.locator('#new-queue-btn').click();
  await expect(page.locator('[data-screen="queueform"]')).toBeVisible({ timeout: 5_000 });

  await page.locator('#save-queue-btn').click();

  await expect(page.locator('#queueform-error')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#queueform-error')).toContainText('Name is required');
  await expect(page.locator('[data-screen="queueform"]')).toBeVisible();
});

test('provider form shows "Name is required" when saved without a name', async ({ page }) => {
  const { url } = fixture();
  await page.goto(url);
  await page.locator('[data-nav="providers"]').click();
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });

  await page.locator('#new-prov-btn').click();
  await expect(page.locator('[data-screen="provform"]')).toBeVisible({ timeout: 5_000 });

  await page.locator('#save-prov-btn').click();

  await expect(page.locator('#provform-error')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#provform-error')).toContainText('Name is required');
  await expect(page.locator('[data-screen="provform"]')).toBeVisible();
});

test('dashboard dry-run button runs the job in dry-run mode', async ({ page }) => {
  const { url } = fixture();
  await page.goto(url);
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('E2E Copy', { exact: true })).toBeVisible({ timeout: 10_000 });

  const copyRow = page.locator('#dashboard-tbody tr').filter({ hasText: 'E2E Copy' }).first();
  await copyRow.locator('.run-btn[data-dry="true"]').click();

  // Title must include "(dry-run)" to confirm the correct mode was triggered.
  await expect(page.locator('#run-title')).toContainText('dry-run', { timeout: 5_000 });
  await expect(page.locator('#run-status-badge')).toHaveText('success · exit 0', { timeout: 30_000 });
});

test('last-run status badge is shown on the dashboard after a job runs', async ({ page }) => {
  const { url } = fixture();
  await page.goto(url);
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('E2E Copy', { exact: true })).toBeVisible({ timeout: 10_000 });

  // Run the job.
  const copyRow = page.locator('#dashboard-tbody tr').filter({ hasText: 'E2E Copy' }).first();
  await copyRow.locator('.run-btn[data-dry="false"]').click();
  await expect(page.locator('#run-status-badge')).toHaveText('success · exit 0', { timeout: 30_000 });

  // Navigate back to the dashboard via the back button.
  await page.locator('[data-screen="run"] .back-btn').click();
  await expect(page.locator('[data-screen="dashboard"]')).toBeVisible({ timeout: 5_000 });

  // The E2E Copy row should now show a status badge — not "never run".
  const dashRow = page.locator('#dashboard-tbody tr').filter({ hasText: 'E2E Copy' }).first();
  await expect(dashRow.locator('.rounded-full')).not.toContainText('never run');
});

test('dashboard shows the queues section when queues exist', async ({ page }) => {
  const { url } = fixture();
  await page.goto(url);
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });
  // The fixture always has at least E2E Queue, so the section must be visible.
  await expect(page.locator('#dashboard-queues-section')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#dashboard-queues-tbody').getByText('E2E Queue')).toBeVisible();
});

test('dashboard queue Run button starts a queue run', async ({ page }) => {
  const { url } = fixture();
  await page.goto(url);
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#dashboard-queues-section')).toBeVisible({ timeout: 5_000 });

  const qRow = page.locator('#dashboard-queues-tbody tr').filter({ hasText: 'E2E Queue' }).first();
  await qRow.locator('.dash-queue-run-btn').click();

  // Should navigate to the queue run detail screen.
  await expect(page.locator('[data-screen="queuerun"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#queuerun-title')).toHaveText('E2E Queue');
  await expect(page.locator('#queuerun-status-badge')).toHaveText('✓ success', { timeout: 30_000 });
});

test('provider custom key row can be added, saved, and is persisted on the server', async ({ page }) => {
  const { url } = fixture();
  await page.goto(url);
  await page.locator('[data-nav="providers"]').click();
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });

  await page.locator('#new-prov-btn').click();
  await expect(page.locator('[data-screen="provform"]')).toBeVisible({ timeout: 5_000 });

  // Fill name and type first — typing in #p-name triggers renderProviderFields,
  // which would wipe any custom-key rows already added, so we fill these before
  // adding custom keys.
  await page.fill('#p-name', 'temp-custom-key-prov');
  await page.selectOption('#p-type', 'local');

  // Switch to the Advanced tab and add a custom key.
  await page.locator('.prov-tab-btn[data-tab="advanced"]').click();
  await page.locator('#add-custom-key-btn').click();

  // addCustomKey() appends the row to #p-fields (Details tab).
  // Switch back to Details so the row is visible for interaction.
  await page.locator('.prov-tab-btn[data-tab="details"]').click();
  const customRow = page.locator('.custom-key-row').last();
  await customRow.locator('.custom-key').fill('mykey');
  await customRow.locator('.custom-val').fill('myvalue');

  await page.locator('#save-prov-btn').click();
  await expect(page.locator('[data-screen="providers"]')).toBeVisible({ timeout: 5_000 });

  // The provider card must be present (save succeeded and list was refreshed).
  const card = page.locator('#providers-grid > div').filter({ hasText: 'temp-custom-key-prov' });
  await expect(card).toBeVisible({ timeout: 5_000 });

  // Verify the custom key was actually persisted by querying the API from the
  // page context. The card only displays the first 3 extra keys, which may be
  // filled by schema-derived bool fields, so API verification is more reliable.
  const savedProv = await page.evaluate(async () => {
    const r = await fetch('/api/providers/temp-custom-key-prov');
    return r.json();
  });
  expect(savedProv.mykey).toBe('myvalue');
});
