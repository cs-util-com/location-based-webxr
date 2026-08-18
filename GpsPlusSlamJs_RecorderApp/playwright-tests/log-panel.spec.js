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
  test('log panel is hidden initially', async ({ page }) => {
    const panel = page.locator('#log-panel');
    await expect(panel).toHaveClass(/hidden/);
  });

  test('clicking status area shows log panel', async ({ page }) => {
    await dismissSetupModal(page);
    const status = page.locator('#status');
    const panel = page.locator('#log-panel');

    await status.click();

    await expect(panel).not.toHaveClass(/hidden/);
    await expect(panel).toBeVisible();
  });

  test('clicking status area again hides log panel', async ({ page }) => {
    await dismissSetupModal(page);
    const status = page.locator('#status');
    const panel = page.locator('#log-panel');
    const closeBtn = page.locator('#log-panel-close');

    // Show
    await status.click();
    await expect(panel).toBeVisible();

    // Hide via close button (status is covered by panel when visible)
    await closeBtn.click();
    await expect(panel).toHaveClass(/hidden/);

    // Verify we can show again
    await status.click();
    await expect(panel).toBeVisible();
  });

  test('clicking close button hides log panel', async ({ page }) => {
    await dismissSetupModal(page);
    const status = page.locator('#status');
    const panel = page.locator('#log-panel');
    const closeBtn = page.locator('#log-panel-close');

    // Show panel
    await status.click();
    await expect(panel).toBeVisible();

    // Close via button
    await closeBtn.click();
    await expect(panel).toHaveClass(/hidden/);
  });
});

test.describe('Log Panel - Content Display', () => {
  test('panel shows log entries when opened', async ({ page }) => {
    await waitForTestHooks(page);

    // Trigger some logs via test hook
    await page.evaluate(() => {
      window.testHooks.logInfo('GPS', 'Watch started');
      window.testHooks.logWarn('Storage', 'Low disk space');
    });

    // Open panel via hook (bypasses modal)
    await page.evaluate(() => {
      window.testHooks.showLogPanel();
    });

    const content = page.locator('#log-panel-content');
    await expect(content).toContainText('Watch started');
    await expect(content).toContainText('Low disk space');
  });

  test('panel shows tag prefixes', async ({ page }) => {
    await waitForTestHooks(page);

    await page.evaluate(() => {
      window.testHooks.logInfo('MyModule', 'Test message');
    });

    await page.evaluate(() => {
      window.testHooks.showLogPanel();
    });

    const content = page.locator('#log-panel-content');
    await expect(content).toContainText('[MyModule]');
  });

  test('panel shows timestamps in HH:MM:SS format', async ({ page }) => {
    await waitForTestHooks(page);

    await page.evaluate(() => {
      window.testHooks.logInfo('Test', 'Test message');
    });

    await page.evaluate(() => {
      window.testHooks.showLogPanel();
    });

    const content = page.locator('#log-panel-content');
    // Match timestamp pattern HH:MM:SS
    await expect(content).toContainText(/\d{2}:\d{2}:\d{2}/);
  });

  test('error entries have error styling', async ({ page }) => {
    await waitForTestHooks(page);

    await page.evaluate(() => {
      window.testHooks.logError('Critical', 'Something broke');
    });

    await page.evaluate(() => {
      window.testHooks.showLogPanel();
    });

    const errorEntry = page.locator('.log-entry-error');
    await expect(errorEntry).toBeVisible();
    await expect(errorEntry).toContainText('Something broke');
  });

  test('warn entries have warn styling', async ({ page }) => {
    await waitForTestHooks(page);

    await page.evaluate(() => {
      window.testHooks.logWarn('Caution', 'Be careful');
    });

    await page.evaluate(() => {
      window.testHooks.showLogPanel();
    });

    const warnEntry = page.locator('.log-entry-warn');
    await expect(warnEntry).toBeVisible();
    await expect(warnEntry).toContainText('Be careful');
  });
});

test.describe('Log Panel - Live Updates', () => {
  test('new logs appear while panel is open', async ({ page }) => {
    await waitForTestHooks(page);

    // Open panel first via hook
    await page.evaluate(() => {
      window.testHooks.showLogPanel();
    });

    const content = page.locator('#log-panel-content');

    // Log something while panel is open
    await page.evaluate(() => {
      window.testHooks.logInfo('Live', 'New message arrived');
    });

    await expect(content).toContainText('New message arrived');
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

test.describe('Log Panel - testHooks verification', () => {
  test('showLogPanel hook works', async ({ page }) => {
    await waitForTestHooks(page);

    await page.evaluate(() => {
      window.testHooks.showLogPanel();
    });

    const panel = page.locator('#log-panel');
    await expect(panel).toBeVisible();
  });

  test('hideLogPanel hook works', async ({ page }) => {
    await waitForTestHooks(page);

    // Show first
    await page.evaluate(() => {
      window.testHooks.showLogPanel();
    });

    const panel = page.locator('#log-panel');
    await expect(panel).toBeVisible();

    // Hide
    await page.evaluate(() => {
      window.testHooks.hideLogPanel();
    });

    await expect(panel).toHaveClass(/hidden/);
  });

  test('toggleLogPanel hook works', async ({ page }) => {
    await waitForTestHooks(page);
    const panel = page.locator('#log-panel');

    // Toggle on
    await page.evaluate(() => {
      window.testHooks.toggleLogPanel();
    });
    await expect(panel).toBeVisible();

    // Toggle off
    await page.evaluate(() => {
      window.testHooks.toggleLogPanel();
    });
    await expect(panel).toHaveClass(/hidden/);
  });

  test('logInfo hook adds entry to buffer', async ({ page }) => {
    await waitForTestHooks(page);

    await page.evaluate(() => {
      window.testHooks.logInfo('TestTag', 'Test info message');
      window.testHooks.showLogPanel();
    });

    const content = page.locator('#log-panel-content');
    await expect(content).toContainText('[TestTag]');
    await expect(content).toContainText('Test info message');
  });

  test('logError hook adds entry with error styling', async ({ page }) => {
    await waitForTestHooks(page);

    await page.evaluate(() => {
      window.testHooks.logError('ErrorTag', 'Test error message');
      window.testHooks.showLogPanel();
    });

    const errorEntry = page.locator('.log-entry-error');
    await expect(errorEntry).toContainText('Test error message');
  });
});
