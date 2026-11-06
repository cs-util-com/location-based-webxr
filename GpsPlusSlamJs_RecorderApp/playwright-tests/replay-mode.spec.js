import { test, expect } from './e2e-test.js';

/**
 * Replay Mode E2E Tests
 *
 * These tests verify the desktop replay UX that appears when WebXR is not
 * supported (the default in Playwright's Chromium — no fakeWebXRSupport).
 *
 * Why these tests matter:
 * - Risk R10: All replay logic was previously validated only with unit tests
 *   and heavy mocking (WebGLRenderer, OrbitControls, FileSystemDirectoryHandle).
 *   These E2E tests verify the real browser behavior: no WebXR detected →
 *   replay setup UI shown → correct elements visible/hidden.
 * - The replay mode is specifically designed for desktop browsers, so it MUST
 *   work in Playwright's Chromium without any WebXR faking.
 *
 * @see docs/2026-02-19-replay-mode.md Issue 1, Risk R10
 */

test.describe('Replay Mode — Desktop Browser', () => {
  // NOTE: We intentionally do NOT call fakeWebXRSupport(page) here.
  // Playwright's Chromium has no WebXR, so the app should auto-detect
  // this and switch to replay mode (Issue 1, Option A).

  test('without WebXR the page boots to the replay setup, on a clean console @pr', async ({
    page,
  }) => {
    // Known, expected error patterns when WebXR is unavailable in Playwright's
    // Chromium. Only these specific patterns are suppressed — any other error
    // (even if it happens to mention "xr" as a substring) will fail the test.
    // This avoids the broad `includes('xr')` filter that could hide real bugs
    // (e.g. errors containing "extra", "extraneous", etc.).
    const EXPECTED_WEBXR_PATTERNS = [
      /webxr/i, // Three.js or browser WebXR availability warnings
      /navigator\.xr/i, // Direct navigator.xr access errors
      /immersive-ar/i, // Session-type-specific errors
      /xrsession/i, // XRSession API errors
      /xrwebgllayer/i, // XR rendering layer errors
      /ar.*not.*support/i, // "AR not supported" messages from xr-error-handler
      /failed to start ar/i, // Unknown XR error fallback message
    ];

    function isExpectedWebXRError(text) {
      return EXPECTED_WEBXR_PATTERNS.some((pattern) => pattern.test(text));
    }

    const consoleErrors = [];

    page.on('console', (message) => {
      if (message.type() === 'error') {
        const text = message.text();
        if (!isExpectedWebXRError(text)) {
          consoleErrors.push(text);
        }
      }
    });

    page.on('pageerror', (error) => {
      if (!isExpectedWebXRError(error.message)) {
        consoleErrors.push(error.message);
      }
    });

    await page.goto('/');

    await test.step('the replay setup appears', async () => {
      // The replay setup section should become visible
      await page
        .locator('#replay-setup')
        .waitFor({ state: 'visible', timeout: 10_000 });

      // The title should reflect replay mode
      await expect(page.locator('#setup-title')).toHaveText(
        'GPS + SLAM Replay'
      );
    });

    await test.step('recording-specific UI is hidden', async () => {
      await expect(page.locator('#btn-enter-ar')).toBeHidden();
      await expect(page.locator('#btn-choose-save')).toBeHidden();
      await expect(page.locator('#permission-section')).toBeHidden();
      await expect(page.locator('#btn-settings')).toBeHidden();
      await expect(page.locator('#session-notes')).toBeHidden();
      await expect(page.locator('#new-scenario-section')).toBeHidden();
    });

    await test.step('the folder button speaks of replay', async () => {
      const folderBtn = page.locator('#btn-open-folder');
      await expect(folderBtn).toBeVisible();
      await expect(folderBtn).toHaveText(/Open Recordings Folder/);
    });

    // Why: Verifies that the setup screen no longer has a speed input (Issue 1 —
    // speed only adjustable at runtime via live overlay), and that the live overlay
    // speed presets include slow-motion values (Issue 2 — [0.1, 0.2, 0.5, 1, 2, 5, 10]).
    await test.step('no speed control on setup; slow-motion presets in the live overlay', async () => {
      // Speed input should NOT be present on setup screen (Issue 1)
      await expect(page.locator('#replay-speed-input')).not.toBeVisible();
      expect(await page.locator('.replay-speed-preset').count()).toBe(0);

      // Live overlay speed presets exist in the DOM (hidden until replay starts)
      // Verify the expected 7 presets from Issue 2: 0.1, 0.2, 0.5, 1, 2, 5, 10
      await expect(page.locator('.replay-live-speed')).toHaveCount(7);
      await expect(page.locator('[data-replay-speed="0.1"]')).toBeAttached();
      await expect(page.locator('[data-replay-speed="0.2"]')).toBeAttached();
      await expect(page.locator('[data-replay-speed="0.5"]')).toBeAttached();
      await expect(page.locator('[data-replay-speed="1"]')).toBeAttached();
      await expect(page.locator('[data-replay-speed="10"]')).toBeAttached();
    });

    await test.step('nothing can start before a session is selected', async () => {
      const startBtn = page.locator('#btn-start-replay');
      await expect(startBtn).toBeVisible();
      await expect(startBtn).toBeDisabled();

      const scenarioSelect = page.locator('#replay-scenario-select');
      await expect(scenarioSelect).toBeVisible();
      await expect(scenarioSelect).toBeDisabled();
    });

    await test.step('the console stayed clean', async () => {
      // Wait for the status text to confirm initialization is complete.
      // We avoid `waitForLoadState('networkidle')` here because Vite's
      // dev server keeps an HMR WebSocket open indefinitely, which
      // prevents 'networkidle' from resolving and causes timeouts under
      // concurrent worker load.
      await expect(page.locator('#status-text')).toContainText('Replay Mode', {
        timeout: 10_000,
      });

      expect(consoleErrors).toEqual([]);
    });
  });
});
