import { test, expect, type ConsoleMessage } from '@playwright/test';
import path from 'path';

/**
 * Verifies the "Sync from nesso" button on the RecordingView toolbar.
 *
 * Flow under test:
 *   1. Open label-app on bigmac.
 *   2. Select project `bridge-prod-test` (id=1) so the recording view has an
 *      active project to scope the import to.
 *   3. Open dataset `breville-pull-prod`, then open recording id=2 — the
 *      5-hour Breville window whose metadata advertises source=nesso_pg and
 *      which has 4 historical nesso labels (2 cogsworth brew_barista + 2
 *      firmware-tap shot.start/end) already mirrored into project 1.
 *   4. Assert the [data-testid="sync-nesso"] button is visible (it should
 *      only render for nesso_pg-sourced recordings).
 *   5. Click it; assert [data-testid="sync-status"] appears within 10s with
 *      either "Up to date" or "Pulled N" text.
 *   6. Assert zero console errors / page errors.
 *   7. Screenshot.
 */

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

test('sync-button: Sync from nesso pulls historical labels on nesso_pg recording', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') {
      const loc = msg.location();
      const line = `[console.error] ${msg.text()} (at ${loc.url}:${loc.lineNumber}:${loc.columnNumber})`;
      consoleErrors.push(line);
      console.log(line);
    }
  });
  page.on('pageerror', (err) => {
    const line = `[pageerror] ${err.name}: ${err.message}\n${err.stack ?? ''}`;
    pageErrors.push(line);
    console.log(line);
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.sidebar')).toBeVisible();

  // --- 1. Pick project (scopes the sync import) ---
  await page.getByRole('button', { name: 'Projects' }).click();
  const projectItem = page.locator('.list-item', { hasText: 'bridge-prod-test' });
  await expect(projectItem).toBeVisible({ timeout: 10_000 });
  await projectItem.click();
  await expect(projectItem).toHaveClass(/selected/);

  // --- 2. Open the 5-hour nesso_pg-sourced dataset ---
  await page.getByRole('button', { name: 'Datasets' }).click();
  const datasetItem = page.locator('.list-item', { hasText: 'breville-pull-prod' });
  await expect(datasetItem).toBeVisible({ timeout: 10_000 });
  await datasetItem.click();

  // The recording table should show at least one row; we want id=2.
  await expect(page.locator('.recording-table')).toBeVisible();
  const recordingRow = page
    .locator('.recording-table tbody tr')
    .filter({ hasText: '2' })
    .first();
  // Fall back to the first row if the explicit id-text filter doesn't pin
  // recording 2 (the dataset only contains one recording in fixtures).
  const rowToClick = (await recordingRow.count()) > 0
    ? recordingRow
    : page.locator('.recording-table tbody tr').first();
  await expect(rowToClick).toBeVisible();
  await rowToClick.click();

  // Wait for the Plotly chart to mount so we know the recording view is live.
  const plotlyChart = page.locator('.js-plotly-plot').first();
  await expect(plotlyChart).toBeVisible({ timeout: 20_000 });

  // --- 3. The sync button should appear (only renders for nesso_pg source) ---
  const syncButton = page.locator('[data-testid="sync-nesso"]');
  await expect(syncButton).toBeVisible({ timeout: 10_000 });

  // --- 4. Click and observe status ---
  await syncButton.click();

  const syncStatus = page.locator('[data-testid="sync-status"]');
  await expect(syncStatus).toBeVisible({ timeout: 10_000 });
  await expect(syncStatus).toHaveText(/Up to date|Pulled \d+/, { timeout: 10_000 });

  const observedStatus = (await syncStatus.textContent()) ?? '';
  console.log(`sync-status text: "${observedStatus.trim()}"`);

  // --- 5. Screenshot the post-sync state ---
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'sync-button.png'),
    fullPage: true,
  });

  // --- 6. No console / page errors ---
  if (consoleErrors.length || pageErrors.length) {
    console.log('Console errors:\n' + consoleErrors.join('\n'));
    console.log('Page errors:\n' + pageErrors.join('\n'));
  }
  expect(consoleErrors, `console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
