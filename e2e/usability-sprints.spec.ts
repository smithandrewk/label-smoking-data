import { test, expect, type ConsoleMessage } from '@playwright/test';
import path from 'path';

/**
 * Verifies three sprints of UX work on the recording view of the label-app:
 *
 *   Sprint 1 — keyboard shortcuts + help modal
 *     - `?` button + `?` key toggle a help modal ([data-testid="keyboard-help"]).
 *     - Escape closes it.
 *     - `f` toggles a fullscreen plot wrap ([data-testid="plot-fullscreen-wrap"]
 *       becomes position:fixed when on).
 *     - `1`..`9` activate the Nth label chip (cycling — same key again deactivates).
 *     - `0` deactivates the current chip.
 *
 *   Sprint 2 — optimistic UI + visible state
 *     - Annotation count badge ([data-testid="annotation-count"]) shows
 *       "N labels", with "· saving…" suffix during pending mutations.
 *     - Drawing a bout (two plotly_click events) inserts a row into the
 *       annotation table BEFORE the server confirms — verified by the badge
 *       count incrementing immediately.
 *
 *   Sprint 3 — bulk relabel
 *     - When an activeLabel is set AND at least one annotation's midpoint
 *       falls inside the current viewport AND its label_name !== activeLabel.name,
 *       a [data-testid="bulk-relabel"] button appears reading
 *       "Relabel N visible → <label>". We assert presence + text. We DO NOT
 *       click it (would mutate prod data).
 *
 * Pre-seeded state used:
 *   - project `bridge-prod-test` (id=1), label_schema=[{name:"shot",
 *     color:"#fb923c"}]
 *   - dataset `breville-pull-prod` (id=2), recording id=2 (5-hour Breville
 *     window), 4 historical annotations: 2 shot.start/end (nesso-unknown) +
 *     2 brew_barista (nesso-cogsworth). None of those equal "shot" so the
 *     bulk-relabel target count is 4 when activeLabel=shot.
 */

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const API_BASE = 'http://bigmac.tail06507a.ts.net:5001';

test('usability sprints: keyboard help, optimistic insert, bulk-relabel button', async ({
  page,
  request,
}) => {
  // Three sprints' worth of UI verification + a cleanup re-navigation pushes
  // beyond the default 60s budget. 180s is plenty.
  test.setTimeout(180_000);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const scriptSrcs: string[] = [];

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
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/assets/') && url.endsWith('.js')) scriptSrcs.push(url);
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.sidebar')).toBeVisible();

  // --- Bundle hash check (cache-bust verification) ---
  const indexBundles = scriptSrcs.filter((s) =>
    /\/assets\/index-[A-Za-z0-9_-]+\.js/.test(s),
  );
  expect(
    indexBundles,
    `expected /assets/index-*.js to load, got: ${scriptSrcs.join(', ')}`,
  ).not.toHaveLength(0);
  const expectedHash = 'index-B-WWrSvN.js';
  const newBundle = indexBundles.filter((s) => s.includes(expectedHash));
  expect(
    newBundle,
    `expected ${expectedHash}; got: ${indexBundles.join(', ')}`,
  ).not.toHaveLength(0);
  console.log(`bundle served: ${newBundle.join(', ')}`);

  // --- Pick project (wires AnnotationToolbar + annotation queries) ---
  await page.getByRole('button', { name: 'Projects' }).click();
  const projectItem = page.locator('.list-item', { hasText: 'bridge-prod-test' });
  await expect(projectItem).toBeVisible({ timeout: 10_000 });
  await projectItem.click();
  await expect(projectItem).toHaveClass(/selected/);

  // --- Open 5-hour Breville dataset + recording id=2 ---
  await page.getByRole('button', { name: 'Datasets' }).click();
  const datasetItem = page.locator('.list-item', { hasText: 'breville-pull-prod' });
  await expect(datasetItem).toBeVisible({ timeout: 10_000 });
  await datasetItem.click();

  await expect(page.locator('.recording-table')).toBeVisible();
  const recordingRow = page.locator('.recording-table tbody tr').first();
  await expect(recordingRow).toBeVisible();
  await recordingRow.click();

  // Wait for plot mount + traces (so the 50ms-mount viewport emit has fired).
  const plotlyChart = page.locator('.js-plotly-plot').first();
  await expect(plotlyChart).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.annotation-toolbar').first()).toBeVisible();
  await page.waitForFunction(
    () => {
      const legendText = document.querySelector('.js-plotly-plot .legend')?.textContent ?? '';
      return ['accel_x', 'accel_y', 'accel_z', 'gyro_x', 'gyro_y', 'gyro_z'].every(
        (c) => legendText.includes(c),
      );
    },
    null,
    { timeout: 20_000 },
  );

  // Give the 50ms onMount viewport emit + react-query annotations fetch time
  // to settle so the badge text is stable.
  await page.waitForTimeout(300);

  // =====================================================================
  // SPRINT 1 — keyboard shortcuts + help modal
  // =====================================================================

  const helpModal = page.locator('[data-testid="keyboard-help"]');
  const helpButton = page.locator('[data-testid="open-keyboard-help"]');

  // 1a. `?` button opens the help modal.
  await expect(helpButton).toBeVisible();
  await helpButton.click();
  await expect(helpModal).toBeVisible();
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'sprint1-help.png'),
    fullPage: true,
  });

  // 1b. Escape closes it.
  await page.keyboard.press('Escape');
  await expect(helpModal).toBeHidden();

  // 1c. `?` key reopens it.
  await page.keyboard.press('?');
  await expect(helpModal).toBeVisible();

  // 1d. `?` key again closes it (toggle).
  await page.keyboard.press('?');
  await expect(helpModal).toBeHidden();

  // 1e. Fullscreen plot toggle via `f`.
  const fullscreenWrap = page.locator('[data-testid="plot-fullscreen-wrap"]');
  await expect(fullscreenWrap).toBeVisible();
  const positionBefore = await fullscreenWrap.evaluate(
    (el) => window.getComputedStyle(el).position,
  );
  expect(positionBefore).not.toBe('fixed');

  await page.keyboard.press('f');
  await expect
    .poll(
      async () => fullscreenWrap.evaluate((el) => window.getComputedStyle(el).position),
      { timeout: 3000 },
    )
    .toBe('fixed');
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'sprint1-fullscreen.png'),
    fullPage: true,
  });

  await page.keyboard.press('f');
  await expect
    .poll(
      async () => fullscreenWrap.evaluate((el) => window.getComputedStyle(el).position),
      { timeout: 3000 },
    )
    .not.toBe('fixed');

  // 1f. `1` activates the `shot` chip; press again deactivates; reactivate.
  const shotChip = page.locator('.label-chip', { hasText: 'shot' });
  await expect(shotChip).toBeVisible();
  await expect(shotChip).not.toHaveClass(/active/);

  await page.keyboard.press('1');
  await expect(shotChip).toHaveClass(/active/);

  await page.keyboard.press('1');
  await expect(shotChip).not.toHaveClass(/active/);

  // Reactivate for the remaining sprints.
  await page.keyboard.press('1');
  await expect(shotChip).toHaveClass(/active/);

  // =====================================================================
  // SPRINT 2 — optimistic insert + visible badge state
  // =====================================================================

  const countBadge = page.locator('[data-testid="annotation-count"]');
  await expect(countBadge).toBeVisible();

  // Read baseline count from badge text. Format: "N labels" or "N label".
  const baselineText = (await countBadge.textContent())?.trim() ?? '';
  const baselineMatch = baselineText.match(/^(\d+)\s+label/);
  expect(baselineMatch, `unexpected badge text: "${baselineText}"`).not.toBeNull();
  const baselineCount = Number(baselineMatch![1]);
  console.log(`baseline annotation count from badge: ${baselineCount}`);
  // Sanity: 4 pre-seeded historical annotations.
  expect(baselineCount).toBeGreaterThanOrEqual(4);

  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'sprint2-badge.png'),
    fullPage: true,
  });

  // Fire two plotly_click events at x=60 and x=180 (sec since rec start).
  // The 5h recording covers 0..18000s and the initial viewport covers ~all of
  // it, so 60..180 is well inside.
  await page.evaluate(() => {
    const el = document.querySelector('.js-plotly-plot') as any;
    if (!el || typeof el.emit !== 'function') {
      throw new Error('plot element missing or has no .emit()');
    }
    el.emit('plotly_click', { points: [{ x: 60 }] });
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const el = document.querySelector('.js-plotly-plot') as any;
    el.emit('plotly_click', { points: [{ x: 180 }] });
  });

  // Optimistic: badge should hit baseline+1 quickly (before server round-trip).
  await expect
    .poll(async () => (await countBadge.textContent())?.trim() ?? '', {
      timeout: 5000,
      intervals: [50, 100, 150, 200, 300],
    })
    .toMatch(new RegExp(`^${baselineCount + 1}\\s+labels?\\b`));

  // While the mutation is in flight the badge should show "· saving…". We try
  // to observe this transiently — but it may already have resolved by the
  // time we look on a fast local network. Capture either way as a soft signal.
  const sawSaving = await page
    .locator('[data-testid="annotation-count"]', { hasText: 'saving' })
    .first()
    .isVisible()
    .catch(() => false);
  console.log(`saw "· saving…" suffix transiently: ${sawSaving}`);

  // Now wait for the saving suffix to clear (final server confirm).
  await expect
    .poll(async () => (await countBadge.textContent())?.trim() ?? '', { timeout: 10_000 })
    .not.toMatch(/saving/);

  // Final badge should still read baseline+1 (server confirmed our row).
  const finalText = (await countBadge.textContent())?.trim() ?? '';
  expect(finalText).toMatch(new RegExp(`^${baselineCount + 1}\\s+labels?\\b`));
  console.log(`post-confirm badge text: "${finalText}"`);

  // --- Cleanup: delete the new annotation via /api/annotations DELETE -----
  // Look up the new row: filter annotations for recording_id=2 + project_id=1
  // + label_name=shot. The 4 pre-seeded rows have labels shot.start, shot.end,
  // brew_barista, brew_barista — none are "shot" — so the new row is the only
  // one with label_name === "shot".
  const annsResp = await request.get(
    `${API_BASE}/api/annotations?recording_id=2&project_id=1`,
  );
  expect(annsResp.ok()).toBe(true);
  const allAnns = (await annsResp.json()) as Array<{
    id: number;
    label_name: string;
    start_ns: number;
    end_ns: number;
  }>;
  const shotRows = allAnns.filter((a) => a.label_name === 'shot');
  expect(
    shotRows.length,
    `expected exactly 1 new "shot" row, got ${shotRows.length}`,
  ).toBe(1);
  const newId = shotRows[0].id;
  console.log(`new annotation id to delete: ${newId}`);

  const delResp = await request.delete(`${API_BASE}/api/annotations/${newId}`);
  expect(
    delResp.ok(),
    `DELETE /api/annotations/${newId} failed: ${delResp.status()}`,
  ).toBe(true);

  // Verify the DELETE landed at the API level (the badge in the UI is on a
  // stale react-query cache because we deleted via raw HTTP, bypassing the
  // useMutation cache invalidation; revisiting the same recording doesn't
  // force a refetch within the query staleTime). The authoritative check is
  // the API itself — re-list and confirm we're back to the 4 baseline rows.
  const verifyResp = await request.get(
    `${API_BASE}/api/annotations?recording_id=2&project_id=1`,
  );
  const finalAnns = (await verifyResp.json()) as Array<{ label_name: string }>;
  console.log(
    `post-delete annotation list (${finalAnns.length}): ${finalAnns
      .map((a) => a.label_name)
      .join(', ')}`,
  );
  expect(finalAnns.length).toBe(baselineCount);
  expect(finalAnns.find((a) => a.label_name === 'shot')).toBeUndefined();

  // =====================================================================
  // SPRINT 3 — bulk relabel visible bouts
  // =====================================================================

  // Hard reload to get a clean react-query cache (no stale optimistic row).
  // After reload the zustand store resets, so we re-navigate manually.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.getByRole('button', { name: 'Projects' }).click();
  await page.locator('.list-item', { hasText: 'bridge-prod-test' }).click();
  await page.getByRole('button', { name: 'Datasets' }).click();
  await page.locator('.list-item', { hasText: 'breville-pull-prod' }).click();
  await expect(page.locator('.recording-table')).toBeVisible();
  await page.locator('.recording-table tbody tr').first().click();

  // Re-wait for plot to remount post-reload.
  await expect(plotlyChart).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(
    () => {
      const legendText = document.querySelector('.js-plotly-plot .legend')?.textContent ?? '';
      return ['accel_x', 'accel_y', 'accel_z'].every((c) => legendText.includes(c));
    },
    null,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(300);

  // Reactivate the `shot` chip via key `1`.
  const shotChip2 = page.locator('.label-chip', { hasText: 'shot' });
  await expect(shotChip2).toBeVisible();
  await page.keyboard.press('1');
  await expect(shotChip2).toHaveClass(/active/);

  // The bulk-relabel button should appear: 4 historical annotations are all
  // inside the default viewport (first-mount = full range) AND none of their
  // label_names is "shot".
  const bulkButton = page.locator('[data-testid="bulk-relabel"]');
  await expect(bulkButton).toBeVisible({ timeout: 10_000 });
  const buttonText = (await bulkButton.textContent())?.trim() ?? '';
  console.log(`bulk-relabel button text: "${buttonText}"`);
  expect(buttonText).toBe('Relabel 4 visible → shot');

  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'sprint3-bulk.png'),
    fullPage: true,
  });

  // DO NOT click the bulk-relabel button — it would mutate prod data.

  // =====================================================================
  // Zero console / page errors.
  // =====================================================================
  if (consoleErrors.length || pageErrors.length) {
    console.log('Console errors:\n' + consoleErrors.join('\n'));
    console.log('Page errors:\n' + pageErrors.join('\n'));
  }
  expect(consoleErrors, `console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
