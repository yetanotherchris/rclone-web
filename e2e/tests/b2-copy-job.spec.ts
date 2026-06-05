import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { b2FromEnv, dstRemote, loadEnvLocal, rclone } from '../b2';

const FIXTURE_PATH = path.join(__dirname, '../.fixture.json');

function fixture() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'));
}

// Opt-in: skipped at runtime unless e2e/.env.local provided B2 creds, in which
// case global-setup added the "E2E B2 Copy" job and seeded the source bucket.
// The skip is decided inside the test (not at module load) because Playwright
// imports spec files during collection, before global-setup writes the fixture.
test('B2 bucket-to-bucket: copy job populates the destination bucket', async ({
  page,
}) => {
  const { url, cloudEnabled, b2JobId, b2JobName } = fixture();
  test.skip(!cloudEnabled, 'set e2e/.env.local with RW_E2E_B2_* to enable');

  await page.goto(url);

  // Run the B2 job specifically (there are now two jobs), keyed by job id.
  await expect(page.getByText(b2JobName)).toBeVisible({ timeout: 10_000 });
  await page
    .locator(`.run-btn[data-job-id="${b2JobId}"][data-dry="false"]`)
    .click();

  // B2 transfers are networked, so allow more time than the local copy.
  await expect(page.locator('#run-status-badge')).toHaveText('success · exit 0', {
    timeout: 120_000,
  });

  // Verify the destination bucket prefix now lists the seeded files. B2
  // listings can lag briefly after a write, so poll rather than asserting once.
  loadEnvLocal();
  const b2 = b2FromEnv();
  expect(b2).not.toBeNull();
  await expect
    .poll(
      () =>
        rclone(b2!, ['lsf', dstRemote(b2!)])
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
      { timeout: 15_000, intervals: [500, 1000, 2000] },
    )
    .toEqual(expect.arrayContaining(['hello.txt', 'world.txt']));
});
