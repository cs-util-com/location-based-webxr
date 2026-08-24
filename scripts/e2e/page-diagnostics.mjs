// Putting the browser's own account of a failure into the failure report.
//
// THE INCIDENT THIS EXISTS FOR (2026-08-16). `GpsPlusSlamJs_OsmDemo`'s suite
// failed 45 times with one message — "waited 60 s for `#status`". The cause was a
// single line the browser had already printed:
//
//   Failed to load resource: 404  /@fs/…/GpsPlusSlamJs_Osm/dist/mesh-CZafImwM.js
//
// It was in the page console for the entire investigation. Playwright's failure
// output does not include console messages, the suite captured none, and traces
// are kept only `on-first-retry` with retries at 0 locally — so the one line
// naming the cause was reachable only by re-running with tracing forced and
// unzipping the result. Two wrong diagnoses and a mislabelled commit came out of
// that gap, and none of it was a code defect.
//
// DIAGNOSIS ONLY. Nothing here can make a passing test fail: it observes events
// and attaches text when a test has ALREADY failed.
//
// WHY IT FILTERS BY ORIGIN. `fixtures.js` deliberately aborts and 4xx-stubs
// third-party requests — the rule sheet, Overpass, DEM tiles — on essentially
// every test. Reporting those would put at least one "failure" in every
// attachment and recreate the signal-to-noise problem this exists to remove. So
// events carrying a URL are kept only when that URL is same-origin with the app;
// events with no URL (an uncaught exception) are always kept.
//
// @see page-diagnostics.mjs.md

/** Beyond this many entries the attachment stops being read. */
export const MAX_ENTRIES = 20;

/**
 * Origin of a URL, or `undefined` when it has none.
 *
 * @param {string | undefined} url
 */
function originOf(url) {
  if (typeof url !== 'string' || url.length === 0) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * Collect the browser's error output for one page.
 *
 * Takes anything with playwright's `page` event API, so it is testable against a
 * tiny fake emitter and carries no `@playwright/test` import — the workspace
 * root cannot resolve that package, only the individual packages can.
 *
 * @param {{ on: (event: string, handler: (payload: any) => void) => void }} page
 * @param {object} [options]
 * @param {string} [options.baseUrl] app origin; events from other origins are
 *   dropped. Omit to keep everything.
 * @returns {{ entries: string[], summary: () => string }}
 */
export function createPageDiagnostics(page, { baseUrl } = {}) {
  const appOrigin = originOf(baseUrl);
  /** @type {string[]} */
  const entries = [];
  const seen = new Set();

  /**
   * @param {string} line
   * @param {string} [url]
   */
  function record(line, url) {
    // An event that names a URL is only ours if it is same-origin. One that
    // names none (an uncaught exception) always is.
    if (appOrigin !== undefined && url !== undefined) {
      const origin = originOf(url);
      if (origin !== undefined && origin !== appOrigin) return;
    }
    // DE-DUPLICATED: a failing module is typically requested by several
    // importers, and twenty copies of one 404 crowds out everything else.
    if (seen.has(line)) return;
    seen.add(line);
    entries.push(line);
  }

  page.on('console', (message) => {
    if (typeof message?.type === 'function' && message.type() !== 'error') return;
    const url = typeof message?.location === 'function' ? message.location()?.url : undefined;
    const text = typeof message?.text === 'function' ? message.text() : String(message);
    record(`console.error: ${text}${url ? ` (${url})` : ''}`, url);
  });

  page.on('pageerror', (error) => {
    record(`uncaught: ${error?.message ?? String(error)}`);
  });

  page.on('requestfailed', (request) => {
    const url = typeof request?.url === 'function' ? request.url() : undefined;
    const failure = typeof request?.failure === 'function' ? request.failure() : undefined;
    record(`request failed: ${failure?.errorText ?? 'unknown'} ${url ?? ''}`.trim(), url);
  });

  page.on('response', (response) => {
    const status = typeof response?.status === 'function' ? response.status() : 0;
    if (status < 400) return;
    const url = typeof response?.url === 'function' ? response.url() : undefined;
    record(`HTTP ${status}: ${url ?? ''}`.trim(), url);
  });

  return {
    entries,
    /**
     * Forget everything collected so far.
     *
     * FOR SHARED PAGES ONLY. A file that creates one page in `beforeAll` and
     * runs many tests against it has a single collector for all of them, so
     * without a reset between tests the third test's attachment would replay the
     * first test's errors. Attaching listeners per test instead would stack a new
     * set of handlers on the same page on every test.
     */
    reset() {
      entries.length = 0;
      seen.clear();
    },
    /** Plain text for the attachment, or `''` when the browser said nothing. */
    summary() {
      if (entries.length === 0) return '';
      const shown = entries.slice(0, MAX_ENTRIES);
      const overflow =
        entries.length > MAX_ENTRIES ? [`…and ${entries.length - MAX_ENTRIES} more`] : [];
      return [
        'The browser reported these while this test was running:',
        '',
        ...shown.map((line) => `  ${line}`),
        ...overflow,
      ].join('\n');
    },
  };
}

/**
 * Attach a collector's output to a finished test, if it failed and said anything.
 *
 * @param {{ summary: () => string }} diagnostics
 * @param {{ status?: string, expectedStatus?: string, attach: Function }} testInfo
 */
export async function attachOnFailure(diagnostics, testInfo) {
  if (testInfo.status === testInfo.expectedStatus) return;
  const body = diagnostics.summary();
  if (body === '') return;
  await testInfo.attach('browser-console', { body, contentType: 'text/plain' });
}
