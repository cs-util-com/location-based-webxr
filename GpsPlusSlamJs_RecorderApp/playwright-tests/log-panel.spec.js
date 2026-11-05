import { test, expect } from './e2e-test.js';
import { waitForTestHooksSubset } from './test-helpers.js';

/**
 * Log Panel E2E Tests
 *
 * These tests verify the expandable log panel that appears when users tap
 * the status area. The panel shows recent log entries with timestamps,
 * tags, and level-based styling.
 *
 * Why this test matters: User feedback Issue #5 requested a way to view
 * detailed logs during field testing to verify everything is working.
 *
 * See docs/2026-01-25-user-feedback.md Issue #5 for context.
 */

/**
 * Wait for testHooks to be available. They're set up asynchronously in dev mode.
 * Uses the shared timeout constant from test-helpers.js.
 * @param {import('@playwright/test').Page} page
 */
async function waitForTestHooks(page) {
  await waitForTestHooksSubset(
    page,
    () =>
      window.testHooks?.showLogPanel &&
      window.testHooks?.hideLogPanel &&
      window.testHooks?.toggleLogPanel &&
      window.testHooks?.logInfo
  );
}

/**
 * Dismiss the setup modal by hiding it via JavaScript.
 * This allows tests to interact with elements behind it.
 * @param {import('@playwright/test').Page} page
 */
async function dismissSetupModal(page) {
  await page.evaluate(() => {
    const modal = document.getElementById('setup-modal');
    if (modal) modal.classList.add('hidden');
  });
}

// Shared setup for all tests
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Wait for log panel to exist (hidden by default)
  await page.locator('#log-panel').waitFor({ state: 'attached' });
});

test.describe('Log Panel - Visibility', () => {
  test('clicking status area shows log panel', async ({ page }) => {
    await dismissSetupModal(page);
    const status = page.locator('#status');
    const panel = page.locator('#log-panel');

    await status.click();

    await expect(panel).not.toHaveClass(/hidden/);
    await expect(panel).toBeVisible();
  });
});

test.describe('Log Panel - Integration with Summary', () => {
  test('View Logs button in summary opens log panel', async ({ page }) => {
    await waitForTestHooks(page);
    await dismissSetupModal(page);

    // Show the session summary
    await page.evaluate(() => {
      window.testHooks.showSessionSummary({
        duration: { startTime: Date.now() - 60000, endTime: Date.now() },
        gpsEventCount: 10,
        refPointCount: 2,
        imageCount: 5,
        depthSampleCount: 20,
        errors: [],
        firstGps: { lat: 50.0, lng: 8.0 },
        lastGps: { lat: 50.001, lng: 8.001 },
        totalDistanceMeters: 100,
      });
    });

    const summaryPanel = page.locator('#session-summary-panel');
    await expect(summaryPanel).toBeVisible();

    // Click View Logs button
    const viewLogsBtn = page.locator('#btn-view-logs');
    await viewLogsBtn.click();

    // Log panel should now be visible
    const logPanel = page.locator('#log-panel');
    await expect(logPanel).toBeVisible();
  });
});
