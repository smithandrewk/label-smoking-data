import { test, expect, type ConsoleMessage } from '@playwright/test';
import path from 'path';

/**
 * Smoke test for the label-app deployed on bigmac.
 *
 * Verifies:
 *   1. SPA mounts (root div populated, sidebar tabs visible).
 *   2. New bundle hash (`index-D...`) is being served — not the broken `index-P...` one.
 *   3. No console errors or uncaught page errors.
 *   4. Imported dataset (`breville-smoke-test`) is navigable.
 *   5. Its recording opens and Plotly renders a non-empty chart.
 */

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

test('label-app smoke: SPA mounts, dataset navigates, Plotly renders', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const scriptSrcs: string[] = [];
  const cdnPlotlyResponses: { url: string; status: number }[] = [];

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') {
      const loc = msg.location();
      const line = `[console.error] ${msg.text()} (at ${loc.url}:${loc.lineNumber}:${loc.columnNumber})`;
      consoleErrors.push(line);
      console.log(line);
    } else if (msg.type() === 'warning') {
      console.log(`[console.warn] ${msg.text()}`);
    }
  });

  page.on('pageerror', (err) => {
    const line = `[pageerror] ${err.name}: ${err.message}\n${err.stack ?? ''}`;
    pageErrors.push(line);
    console.log(line);
  });

  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/assets/') && url.endsWith('.js')) {
      scriptSrcs.push(url);
    }
  });

  page.on('response', (res) => {
    const url = res.url();
    if (url.includes('cdn.plot.ly')) {
      cdnPlotlyResponses.push({ url, status: res.status() });
      console.log(`[cdn.plot.ly] ${res.status()} ${url}`);
    }
    if (url.includes('/assets/') || url.includes('/api/')) {
      const status = res.status();
      if (status >= 400) {
        console.log(`[http ${status}] ${url}`);
      }
    }
  });

  page.on('requestfailed', (req) => {
    const url = req.url();
    if (url.includes('cdn.plot.ly')) {
      cdnPlotlyResponses.push({ url, status: -1 });
      console.log(`[cdn.plot.ly REQUEST FAILED] ${url} :: ${req.failure()?.errorText}`);
    }
  });

  await page.goto('/', { waitUntil: 'networkidle' });

  // Capture root mount state for diagnostics.
  const rootHtmlLen = await page.evaluate(() => {
    const root = document.getElementById('root');
    return root ? root.innerHTML.length : -1;
  });
  console.log(`#root innerHTML length: ${rootHtmlLen}`);

  // 1. SPA mounts — sidebar with title and tabs should be visible.
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Label Tool', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Datasets' })).toBeVisible();

  // 2. Bundle hash check — current build is `index-CvyWzt28.js` (adds the
  // "Sync from nesso" button to RecordingView).
  // Round-1 build was `index-DvIZqgSz.js` (slot-swap bug),
  // Round-2 was `index-C81d9LAA.js` (ternary fold bug),
  // Round-3 was `index-Cb-hrg5U.js` (still had react-plotly.js wrapper bug),
  // Round-4 was `index-DLWr2YGZ.js` (window.Plotly.react/purge rewrite).
  // Confirm at least one /assets/index-*.js loaded, none match the old hashes,
  // and the new hash is present.
  const indexBundles = scriptSrcs.filter((s) => /\/assets\/index-[A-Za-z0-9_-]+\.js/.test(s));
  expect(indexBundles, `expected an /assets/index-*.js bundle to load, got: ${scriptSrcs.join(', ')}`)
    .not.toHaveLength(0);
  const oldBundles = indexBundles.filter((s) =>
    /\/assets\/index-(DvIZqgSz|C81d9LAA|Cb-hrg5U|DLWr2YGZ)\.js/.test(s),
  );
  expect(oldBundles, `old bundle still being served: ${oldBundles.join(', ')}`)
    .toHaveLength(0);
  const newBundles = indexBundles.filter((s) => /\/assets\/index-CvyWzt28\.js/.test(s));
  expect(newBundles, `expected new index-CvyWzt28.js bundle, got: ${indexBundles.join(', ')}`)
    .not.toHaveLength(0);
  console.log('Bundle(s) loaded:', newBundles.join(', '));

  // Report cdn.plot.ly load status — this is the load-bearing piece for round 3.
  console.log(`cdn.plot.ly responses: ${JSON.stringify(cdnPlotlyResponses)}`);
  const plotlyCdnOk = cdnPlotlyResponses.some(
    (r) => r.status === 200 && r.url.includes('plotly-3.0.1.min.js'),
  );
  expect(plotlyCdnOk, `expected a 200 from cdn.plot.ly for plotly-3.0.1.min.js, got: ${JSON.stringify(cdnPlotlyResponses)}`)
    .toBe(true);

  // Plotly should now exist on window.
  const hasWindowPlotly = await page.evaluate(() => typeof (window as any).Plotly !== 'undefined');
  expect(hasWindowPlotly, 'window.Plotly is undefined — CDN script did not execute').toBe(true);

  // Landing screenshot — dataset list visible in sidebar, empty main panel.
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'landing.png'), fullPage: true });

  // 4. Click the imported dataset in the sidebar.
  const datasetItem = page.locator('.list-item', { hasText: 'breville-smoke-test' });
  await expect(datasetItem).toBeVisible({ timeout: 10_000 });
  await datasetItem.click();

  // Recording table should appear.
  await expect(page.locator('.recording-table')).toBeVisible();
  const recordingRow = page.locator('.recording-table tbody tr').first();
  await expect(recordingRow).toBeVisible();

  // 5. Open the recording.
  await recordingRow.click();

  // Plotly renders `.js-plotly-plot` once the chart is up.
  const plotlyChart = page.locator('.js-plotly-plot').first();
  await expect(plotlyChart).toBeVisible({ timeout: 20_000 });

  // Plotly 3.0.1 with scattergl renders traces via WebGL, not SVG paths, so we can't
  // count path `d` attributes. Instead check that the trace legend has all 6 expected
  // channels (this only renders after Plotly has real trace data) and that the axis
  // tick layer has real tick labels.
  await page.waitForFunction(() => {
    const legendText = document.querySelector('.js-plotly-plot .legend')?.textContent ?? '';
    const channels = ['accel_x', 'accel_y', 'accel_z', 'gyro_x', 'gyro_y', 'gyro_z'];
    const hasAllChannels = channels.every((c) => legendText.includes(c));
    const tickCount = document.querySelectorAll('.js-plotly-plot .xtick, .js-plotly-plot .ytick').length;
    return hasAllChannels && tickCount >= 4;
  }, null, { timeout: 20_000 });

  // Sanity: bounding box has area.
  const box = await plotlyChart.boundingBox();
  expect(box, 'plotly chart has no bounding box').not.toBeNull();
  expect(box!.width).toBeGreaterThan(100);
  expect(box!.height).toBeGreaterThan(100);

  // Recording-view screenshot.
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'recording.png'), fullPage: true });

  // 3. Final assertion: zero console errors, zero uncaught page errors.
  if (consoleErrors.length || pageErrors.length) {
    console.log('Console errors observed:\n' + consoleErrors.join('\n'));
    console.log('Page errors observed:\n' + pageErrors.join('\n'));
  }
  expect(consoleErrors, `console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
