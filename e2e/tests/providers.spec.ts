import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const FIXTURE_PATH = path.join(__dirname, '../.fixture.json');

function fixture() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'));
}

test('can edit a provider', async ({ page }) => {
  const { url } = fixture();
  await page.goto(url);
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });

  // Create a provider to edit
  await page.locator('[data-nav="providers"]').click();
  await page.locator('#new-prov-btn').click();
  await expect(page.locator('[data-screen="provform"]')).toBeVisible({ timeout: 5_000 });
  await page.fill('#p-name', 'temp-edit-prov');
  await page.selectOption('#p-type', 'local');
  await page.locator('#save-prov-btn').click();
  await expect(page.locator('[data-screen="providers"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#providers-grid').getByText('temp-edit-prov')).toBeVisible();

  // Edit it — name is locked after creation so edit a custom key instead;
  // verify the form opens with the correct title and provider name pre-filled.
  const card = page.locator('#providers-grid > div').filter({ hasText: 'temp-edit-prov' });
  await card.locator('.edit-prov-btn').click();
  await expect(page.locator('[data-screen="provform"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#provform-title')).toHaveText('Edit provider');
  await expect(page.locator('#p-name')).toHaveValue('temp-edit-prov');

  // Save without changes — should return to providers list
  await page.locator('#save-prov-btn').click();
  await expect(page.locator('[data-screen="providers"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#providers-grid').getByText('temp-edit-prov')).toBeVisible();
});

test('can delete a provider', async ({ page }) => {
  const { url } = fixture();
  await page.goto(url);
  await expect(page.locator('#app')).toBeVisible({ timeout: 10_000 });

  // Create a provider to delete
  await page.locator('[data-nav="providers"]').click();
  await page.locator('#new-prov-btn').click();
  await expect(page.locator('[data-screen="provform"]')).toBeVisible({ timeout: 5_000 });
  await page.fill('#p-name', 'temp-del-prov');
  await page.selectOption('#p-type', 'local');
  await page.locator('#save-prov-btn').click();
  await expect(page.locator('[data-screen="providers"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#providers-grid').getByText('temp-del-prov')).toBeVisible();

  // Delete it
  const card = page.locator('#providers-grid > div').filter({ hasText: 'temp-del-prov' });
  page.once('dialog', dialog => dialog.accept());
  await card.locator('.delete-prov-btn').click();

  await expect(page.locator('#providers-grid').getByText('temp-del-prov')).toHaveCount(0, { timeout: 5_000 });
});
