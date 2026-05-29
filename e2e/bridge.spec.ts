import { test, expect, type ConsoleMessage } from '@playwright/test';
import path from 'path';

/**
 * Phase A bridge verification: label-app UI annotation -> nesso events table.
 *
 * Flow under test (UI):
 *   1. Open label-app on bigmac.
 *   2. Switch sidebar to "Projects" and select `bridge-prod-test`. This wires
 *      the active project into the recording view so AnnotationToolbar renders.
 *   3. Switch back to "Datasets", open `breville-smoke-test`, open recording.
 *   4. Click the "shot" label chip to enter add-annotation mode.
 *   5. Programmatically fire two `plotly_click` events at two x-coords on the
 *      plot. The first sets the pending start, the second creates the bout.
 *      We use plotly's event emitter rather than a synthetic mouse click
 *      because (a) scattergl in WebGL doesn't always emit plotly_click on raw
 *      mouse events in headless chromium, and (b) we want deterministic
 *      x-coords that land inside the recording window.
 *   6. Verify nesso's /labels API returned 2 label-app entries with kind=shot
 *      (the seeded API-test one + our new UI-created one).
 *
 * Pre-seeded state (do NOT mutate):
 *   - label-app project id=1 "bridge-prod-test", label_schema=[{name:"shot",
 *     color:"#fb923c"}]
 *   - label-app dataset id=1 "breville-smoke-test", recording id=1
 *   - nesso /labels window 2026-05-28T15:00-15:05Z contains 1 existing entry
 *     (API curl test, id=9ca5cdf7-...).
 */

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const NESSO_BASE = 'http://bigmac.tail06507a.ts.net:8000';
const DEVICE_ID = '1cbe666a-c5c6-4f2d-bfe0-11e490313638';
const LABELS_URL =
  `${NESSO_BASE}/devices/${DEVICE_ID}/labels` +
  `?since=2026-05-28T15:00:00Z&until=2026-05-28T15:05:00Z`;

test('bridge phase A: UI-drawn annotation mirrors into nesso events table', async ({
  page,
  request,
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

  // Baseline: how many label-app entries are already in nesso for this window?
  const baselineRes = await request.get(LABELS_URL);
  expect(baselineRes.ok(), `nesso /labels GET failed: ${baselineRes.status()}`).toBe(true);
  const baseline = (await baselineRes.json()) as Array<{ labeler: string; kind: string; id: string }>;
  const baselineLabelApp = baseline.filter((b) => b.labeler === 'label-app');
  console.log(`baseline label-app entries in window: ${baselineLabelApp.length}`);
  expect(baselineLabelApp.length).toBeGreaterThanOrEqual(1);

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.sidebar')).toBeVisible();

  // --- 1. Pick project (so AnnotationToolbar renders later) ---
  await page.getByRole('button', { name: 'Projects' }).click();
  const projectItem = page.locator('.list-item', { hasText: 'bridge-prod-test' });
  await expect(projectItem).toBeVisible({ timeout: 10_000 });
  await projectItem.click();
  await expect(projectItem).toHaveClass(/selected/);

  // --- 2. Open dataset + recording ---
  await page.getByRole('button', { name: 'Datasets' }).click();
  const datasetItem = page.locator('.list-item', { hasText: 'breville-smoke-test' });
  await expect(datasetItem).toBeVisible({ timeout: 10_000 });
  await datasetItem.click();

  await expect(page.locator('.recording-table')).toBeVisible();
  const recordingRow = page.locator('.recording-table tbody tr').first();
  await expect(recordingRow).toBeVisible();
  await recordingRow.click();

  // Wait for plot mount and for the AnnotationToolbar (project-gated) to render.
  const plotlyChart = page.locator('.js-plotly-plot').first();
  await expect(plotlyChart).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.annotation-toolbar').first()).toBeVisible();

  // Wait for traces (scattergl legend with all channels).
  await page.waitForFunction(() => {
    const legendText = document.querySelector('.js-plotly-plot .legend')?.textContent ?? '';
    return ['accel_x', 'accel_y', 'accel_z', 'gyro_x', 'gyro_y', 'gyro_z'].every(
      (c) => legendText.includes(c),
    );
  }, null, { timeout: 20_000 });

  // --- 3. Activate the "shot" label ---
  const shotChip = page.locator('.label-chip', { hasText: 'shot' });
  await expect(shotChip).toBeVisible();
  await shotChip.click();
  await expect(shotChip).toHaveClass(/active/);
  // Sanity: the helper text appears once add-mode is on.
  await expect(page.locator('text=Click plot to place annotation start')).toBeVisible();

  // --- 4. Programmatically fire plotly_click twice at deterministic x-coords ---
  // The TimeSeriesPlot's onClick handler reads event.points[0].x (in plot
  // x-coord = seconds-since-recording-start). The recording is 5 min @ 100 Hz,
  // so x range is roughly 0..300s. Pick 30s -> 90s -> creates a 60-second bout.
  // (We also check baseline already covers 50..70s; our 30..90 window doesn't
  // need to be disjoint from that seeded one — they're independent rows.)
  await page.evaluate(
    ({ x0, x1 }) => {
      const el = document.querySelector('.js-plotly-plot') as any;
      if (!el || typeof el.emit !== 'function') {
        throw new Error('plot element missing or has no .emit()');
      }
      // First click: start.
      el.emit('plotly_click', { points: [{ x: x0 }] });
      // Second click: end. Schedule on next tick so React state from the
      // first click (pendingAnnotation) has time to settle before the second
      // handler closure reads it.
    },
    { x0: 30, x1: 90 },
  );
  // small wait for React state flush
  await page.waitForTimeout(150);
  await page.evaluate(
    ({ x1 }) => {
      const el = document.querySelector('.js-plotly-plot') as any;
      el.emit('plotly_click', { points: [{ x: x1 }] });
    },
    { x1: 90 },
  );

  // --- 5. Wait for the new annotation row to appear in the label-app table ---
  // The existing seeded API annotation was 50..70s (20s). Our new one is 30..90s
  // (60s). After the network round-trip + react-query invalidation, the
  // annotation table should show >=2 rows (or at least one with 60.00s duration).
  await expect(async () => {
    const rows = await page.locator('table.recording-table tbody tr').count();
    expect(rows).toBeGreaterThanOrEqual(2);
  }).toPass({ timeout: 15_000 });

  // Screenshot the recording view with the new bout overlaid.
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'bridge-annotation.png'),
    fullPage: true,
  });

  // --- 6. Verify nesso /labels picked up the new bridge row ---
  // The Flask handler INSERTs into nesso synchronously inside the annotation
  // POST, so by the time the label-app UI saw the row, nesso has it too. But
  // be defensive and poll for up to 5s in case of clock skew / replication
  // (unlikely — bigmac is one box).
  let final: Array<{ labeler: string; kind: string; id: string }> = [];
  let attempts = 0;
  while (attempts < 10) {
    const res = await request.get(LABELS_URL);
    expect(res.ok()).toBe(true);
    final = await res.json();
    const labelAppRows = final.filter((b) => b.labeler === 'label-app');
    if (labelAppRows.length >= baselineLabelApp.length + 1) break;
    attempts += 1;
    await page.waitForTimeout(500);
  }
  const finalLabelApp = final.filter((b) => b.labeler === 'label-app');
  console.log(`final label-app entries in window: ${finalLabelApp.length}`);
  console.log(`final payload: ${JSON.stringify(final, null, 2)}`);

  expect(
    finalLabelApp.length,
    `expected baseline+1 label-app entries; got ${finalLabelApp.length}. payload: ${JSON.stringify(final)}`,
  ).toBe(baselineLabelApp.length + 1);

  // All bridge-mirrored entries must be kind="shot" since that's the only
  // label in the schema.
  for (const row of finalLabelApp) {
    expect(row.kind).toBe('shot');
    expect(row.labeler).toBe('label-app');
  }

  // --- 7. Teardown — delete OUR row so the test is idempotent and we
  //        also exercise the DELETE mirror path. Find the new label-app
  //        annotation in label's own DB (the one whose nesso_event_id is
  //        NOT in the baseline), then delete it via label's API.
  const baselineIds = new Set(baselineLabelApp.map((r) => r.id));
  const newRow = finalLabelApp.find((r) => !baselineIds.has(r.id));
  expect(newRow, 'could not find the new label-app row to clean up').toBeTruthy();

  const annResp = await request.get(`http://bigmac.tail06507a.ts.net:5001/api/annotations?recording_id=1`);
  expect(annResp.ok()).toBe(true);
  const allAnns = (await annResp.json()) as Array<{ id: number; nesso_event_id: string | null }>;
  const localAnn = allAnns.find((a) => a.nesso_event_id === newRow!.id);
  expect(localAnn, `no local annotation has nesso_event_id ${newRow!.id}`).toBeTruthy();

  const delResp = await request.delete(`http://bigmac.tail06507a.ts.net:5001/api/annotations/${localAnn!.id}`);
  expect(delResp.ok()).toBe(true);

  // --- 8. Verify the DELETE mirror — nesso row should be gone, back to baseline.
  let postDelete: Array<{ labeler: string; kind: string; id: string }> = [];
  attempts = 0;
  while (attempts < 10) {
    const res = await request.get(LABELS_URL);
    postDelete = await res.json();
    const labelApp = postDelete.filter((b) => b.labeler === 'label-app');
    if (labelApp.length === baselineLabelApp.length) break;
    attempts += 1;
    await page.waitForTimeout(500);
  }
  expect(
    postDelete.filter((b) => b.labeler === 'label-app').length,
    'after teardown delete, label-app rows should be back to baseline',
  ).toBe(baselineLabelApp.length);

  // --- 9. No console / page errors ---
  if (consoleErrors.length || pageErrors.length) {
    console.log('Console errors:\n' + consoleErrors.join('\n'));
    console.log('Page errors:\n' + pageErrors.join('\n'));
  }
  expect(consoleErrors, `console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
