/**
 * Shared Test Helpers for Playwright E2E Tests
 *
 * This module consolidates commonly used helper functions across multiple
 * test files to reduce code duplication and improve maintainability.
 *
 * Why this file exists: Multiple spec files (enter-ar-flow, setup-modal,
 * test-hooks-verification) contained duplicated helper functions for common
 * operations like setting storage/permission states. Centralizing them ensures
 * consistent behavior and easier maintenance.
 */

/**
 * Default timeout (ms) for waitForFunction calls that wait for testHooks.
 *
 * Why this constant exists: Centralises the timeout so every helper and
 * spec file uses the same value. Changing it in one place updates all
 * waitForFunction calls.  The value must cover the slowest observed
 * Vite-module-graph evaluation time (see GpsPlusSlamJs_Docs/docs/implementation-progress.md
 * for measured baselines).
 *
 * Measured baselines (Feb 2026):
 *   - Typical: 100-200 ms, Max observed: ~350 ms
 *   - 5 000 ms gives a ~14× safety margin over worst case.
 *   - If this ever fires, investigate module-load time rather than
 *     increasing the value — see root-cause analysis in progress docs.
 */
export const TEST_HOOKS_TIMEOUT_MS = 5_000;

/**
 * Inject a fake `navigator.xr` so the app sees WebXR as "supported" and
 * stays in recording mode instead of switching to replay mode.
 *
 * MUST be called BEFORE `page.goto('/')` — `addInitScript` runs before any
 * page script so the fake is in place when `checkAllPermissions()` probes
 * `navigator.xr.isSessionSupported('immersive-ar')`.
 *
 * Why this helper exists: Playwright's Chromium does not support WebXR.
 * Without this fake, the app enters replay mode on every page load, hiding
 * recording-specific UI elements (settings button, enter-AR flow, etc.) and
 * causing all recording-UI e2e tests to time out.
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
export async function fakeWebXRSupport(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'xr', {
      value: {
        isSessionSupported: () => Promise.resolve(true),
        requestSession: () =>
          Promise.reject(
            new Error('Fake WebXR — session not available in Playwright')
          ),
      },
      writable: true,
      configurable: true,
    });
  });
}

/**
 * Helper that calls the real populateScenarios function via window.testHooks.
 * This ensures we're testing the actual app behavior, not a simulation.
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string[]} scenarios - Array of existing scenario names
 */
export async function callRealPopulateScenarios(page, scenarios) {
  // Wait for test hooks to be available (they're set up asynchronously)
  await page.waitForFunction(() => window.testHooks?.populateScenarios, {
    timeout: TEST_HOOKS_TIMEOUT_MS,
  });

  await page.evaluate((scenarioList) => {
    window.testHooks.populateScenarios(scenarioList);
  }, scenarios);
}

/**
 * Helper to set permissions as ready via testHooks.
 * This simulates the user granting all required device permissions.
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {Object} [options] - Optional settings
 * @param {boolean} [options.validate=true] - Whether to call validateEnterButton after setting
 */
export async function setPermissionsReady(page, { validate = true } = {}) {
  await page.waitForFunction(() => window.testHooks?.setPermissionsReady, {
    timeout: TEST_HOOKS_TIMEOUT_MS,
  });
  await page.evaluate((shouldValidate) => {
    window.testHooks.setPermissionsReady(true);
    if (shouldValidate) {
      window.testHooks.validateEnterButton();
    }
  }, validate);
}

/**
 * Helper to set mandatory storage as selected via testHooks.
 * This simulates completing the storage setup (Task 1a-fix). Only the save
 * location is mandatory — the read folder is optional (D5) and its
 * write-only `folderSelected` flag was removed end-to-end (quality-review
 * D-3), so save-location selection alone drives Enter-AR readiness.
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {Object} [options] - Optional settings
 * @param {boolean} [options.validate=true] - Whether to call validateEnterButton after setting
 */
export async function setStorageReady(page, { validate = true } = {}) {
  await page.waitForFunction(() => window.testHooks?.setSaveLocationSelected, {
    timeout: TEST_HOOKS_TIMEOUT_MS,
  });
  await page.evaluate((shouldValidate) => {
    window.testHooks.setSaveLocationSelected(true);
    if (shouldValidate) {
      window.testHooks.validateEnterButton();
    }
  }, validate);
}

/**
 * The full `window.testHooks` surface the app exposes — the single source of
 * truth shared by `waitForTestHooks` and the coverage-guard spec in
 * `test-hooks-verification.spec.js`.
 *
 * Why one list: the previous duplicated lists (an inline `&&` chain here plus
 * an `expectedHooks` copy in the guard spec) let quality-review D-3 remove the
 * `setFolderSelected` hook from the app while both stale lists kept requiring
 * it — hanging 88 of 204 specs 30 s each in `beforeEach` (2026-07-11). Keep
 * this list exactly in sync with the `window.testHooks` literal in
 * `src/main.ts`; the guard spec fails with a precise message when it drifts
 * in either direction.
 */
export const REQUIRED_TEST_HOOKS = [
  'populateScenarios',
  'showRecordingControls',
  'hideRecordingControls',
  'showSessionSummary',
  'updateGpsInfo',
  'updateArInfo',
  'validateEnterButton',
  'updatePermissionStatus',
  'setPermissionsReady',
  // Log panel hooks (Issue #5)
  'showLogPanel',
  'hideLogPanel',
  'toggleLogPanel',
  'logInfo',
  'logWarn',
  'logError',
  // GPS event visualizer hooks
  'getGpsEventVisualizerCounts',
  'setGpsEventVisualizerZeroRef',
  'clearGpsEventVisualizer',
  // GPS accuracy ellipsoid hooks (§3c)
  'addGpsEventForTest',
  'getRawGpsMarkerWorldSizes',
  // Tracking quality indicator hook (F1)
  'updateTrackingQuality',
  // Mandatory storage selection hook (Task 1a-fix; the optional-folder
  // twin setFolderSelected was removed end-to-end in quality-review D-3)
  'setSaveLocationSelected',
  // Optional folder-import collapse hook (D5)
  'setFolderImportExpanded',
  // Folder-import indexing progress bar (D2, 2026-07-05)
  'setFolderImportProgress',
  // Map-centric recording browser (Step 4B)
  'mountMapBrowser',
  // Progressive map-browser streaming (Slice A)
  'mountMapBrowserEmpty',
  'streamMapBrowserRecording',
  // Coverage backfill CTA (Slice B / B1)
  'mountMapBrowserBackfill',
  // Toast (2026-08-24) - the toast had no e2e coverage at all until it was
  // rewritten onto the framework's shared mechanism; see toast.spec.js.
  'showToast',
];

/**
 * Wait for core testHooks to be available.
 * Use this in beforeEach when tests depend on testHooks being ready.
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
export async function waitForTestHooks(page) {
  await page.waitForFunction(
    (names) =>
      !!window.testHooks &&
      names.every((n) => typeof window.testHooks[n] === 'function'),
    REQUIRED_TEST_HOOKS,
    { timeout: TEST_HOOKS_TIMEOUT_MS }
  );
}

/**
 * Wait for specific testHooks to be available.
 * Prefer this over a local waitForFunction when a spec only needs a
 * subset of hooks — it keeps the timeout centralised.
 *
 * @param {import('@playwright/test').Page} page
 * @param {(hooks: Record<string, unknown>) => boolean} predicate
 *   Function evaluated in the browser context that receives
 *   `window.testHooks` and returns `true` when the required hooks exist.
 */
export async function waitForTestHooksSubset(page, predicate) {
  await page.waitForFunction(predicate, { timeout: TEST_HOOKS_TIMEOUT_MS });
}
