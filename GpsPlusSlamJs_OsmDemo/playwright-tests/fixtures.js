// @ts-check
/**
 * Network interception for the e2e suite.
 *
 * WHY EVERY EXTERNAL CALL IS INTERCEPTED, and the first reason is not
 * determinism:
 *
 * 1. **The public Overpass instances are donated infrastructure** with a
 *    measured allocation of two slots per client IP, recovering in ~30 s. A CI
 *    suite that hit them on every push would be an abuse of a shared resource,
 *    and the retry-with-backoff path would make every run minutes long.
 * 2. **The rule table is a live Google Sheet** that anyone with access can edit.
 *    A suite depending on it asserts today's spreadsheet, not today's code.
 * 3. Only then: a test that fails because a third party is slow teaches nothing.
 *
 * WHAT IS DELIBERATELY *NOT* FAKED. The interception happens at the HTTP layer,
 * so `OverpassSource`, the parser, `CachingSource`, the OPFS store, the index,
 * the scorer, the region builder and the mesh extruder all run for real. A
 * seam inside the app would have been easier and would have tested the seam.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The app URL that puts the simulated user ON the fixture.
 *
 * The park capture is centred ~2 km from the demo default, and at that distance
 * the working set overlaps none of it — the app renders "0 cells" and every
 * assertion about the grid is vacuously about an empty map. The `?lat=&lng=`
 * override exists so the test can say exactly where it stands.
 */
export const AT_FIXTURE = `/?lat=${50.9231}&lng=${6.9445}`;

/**
 * A real captured Overpass response from the OSM package's fixture corpus.
 *
 * `park` is Cologne Volksgarten — ~2 km from `main.ts`'s default start, which
 * is the whole reason `AT_FIXTURE` exists: served from the default position the
 * features overlap none of the working set and the app renders 0 cells. Read
 * from the sibling package rather than copied, so a re-capture cannot leave this
 * suite asserting stale data.
 */
export function parkPayload() {
  const path = join(
    here,
    '..',
    '..',
    'GpsPlusSlamJs_Osm',
    'src',
    'testdata',
    'park.json'
  );
  return JSON.parse(readFileSync(path, 'utf8')).payload;
}

/**
 * Hosts the app talks to that must never be reached from a test.
 *
 * Matched on HOSTNAME, never as a substring of the whole URL. A pattern like
 * `/overpass/` looks obviously right and is a trap: the app's own module graph
 * contains `overpass-source.js`, `overpass-query.js` and `overpass-status.js`,
 * so a substring route intercepts Vite's own JavaScript and answers it with the
 * JSON fixture. The browser then refuses the module for its MIME type and the
 * app never boots — with the only symptom being a status line stuck on
 * "starting…". That cost a debugging round; hence hostnames.
 */
const isOverpass = (url) =>
  /(^|\.)overpass[^.]*\.de$|(^|\.)kumi\.systems$|(^|\.)openstreetmap\.fr$/i.test(
    url.hostname
  );
const isRuleSheet = (url) => /(^|\.)docs\.google\.com$/i.test(url.hostname);
const isBasemap = (url) => /(^|\.)tile\.openstreetmap\.org$/i.test(url.hostname);

/**
 * Routes the app's outside world to checked-in data.
 *
 * Returns a counter so a test can assert how many Overpass requests were made —
 * which is how the cache is proved to work, and the only way to notice the app
 * quietly refetching on every redraw.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ overpassStatus?: number }} [options]
 */
export async function stubNetwork(page, options = {}) {
  const counts = { overpassStatus: 0, overpassQuery: 0, basemap: 0 };
  const payload = JSON.stringify(parkPayload());

  await page.route(isOverpass, async (route) => {
    // Counted SEPARATELY from queries. A single combined counter cannot express
    // the cache assertion: "at most one more request" also passes when the cache
    // is completely broken and the reload issues exactly one fresh QUERY with no
    // status probe - which is the precise failure that test exists to catch.
    // `/api/status` is the slot-budget probe, not a query, and it costs no slot.
    if (route.request().url().includes('/api/status')) {
      counts.overpassStatus++;
      // Must answer in the plain-text OSM3S format or the client cannot parse
      // its own budget.
      await route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: [
          'Connected as: 1354464119',
          `Current time: ${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}`,
          'Rate limit: 2',
          '2 slots available now.',
          'Currently running queries (pid, space limit, time limit, start time):',
        ].join('\n'),
      });
      return;
    }

    counts.overpassQuery++;

    const status = options.overpassStatus ?? 200;
    if (status !== 200) {
      // 400 rather than 503 on purpose: a non-retryable status escapes the
      // retry loop immediately, so the failure path is exercised in a second
      // instead of through several seconds of exponential backoff. (That
      // "permanent errors must escape the loop" behaviour is itself a fix this
      // package shipped, so the choice is not arbitrary.)
      await route.fulfill({ status, contentType: 'text/plain', body: 'nope' });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: payload,
    });
  });

  // The rule table's three-tier loader degrades live -> cache -> snapshot. An
  // aborted fetch lands it on the checked-in snapshot instantly, which is both
  // deterministic AND the tier the status bar reports, so the test can assert
  // which table it is judging.
  await page.route(isRuleSheet, (route) => route.abort());

  // Basemap tiles are decoration here and cost a third party bandwidth.
  await page.route(isBasemap, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      // 1x1 transparent PNG.
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      ),
    })
  );
  page.on('request', (request) => {
    if (isBasemap(new URL(request.url()))) counts.basemap++;
  });

  return counts;
}

/**
 * Waits for the app to finish a refresh.
 *
 * The status line ends every successful pass with a cell count, so waiting for
 * that is waiting for the real end of the pipeline — no `waitForTimeout`, which
 * this repo forbids because it turns a slow machine into a flaky suite.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function waitForRefresh(page) {
  await page
    .locator('#status')
    .filter({ hasText: /\d+ cells|Failed|unavailable/ })
    .first()
    .waitFor({ state: 'visible', timeout: 60000 });
}
