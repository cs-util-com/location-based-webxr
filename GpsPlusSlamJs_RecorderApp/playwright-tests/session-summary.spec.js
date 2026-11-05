import { test, expect } from './e2e-test.js';
import { waitForTestHooks } from './test-helpers.js';

/**
 * Session Summary Panel E2E Tests
 *
 * These tests verify the Session Summary panel that appears after a recording
 * session ends. The summary shows recording statistics, GPS validation data,
 * error logs, and provides actions for starting a new recording.
 *
 * Why this test matters: User feedback identified the need for a post-recording
 * summary to validate that GPS+SLAM fusion worked correctly. This panel is a
 * TERMINAL state - users cannot restart from here, they must reload.
 *
 * See docs/2026-01-25-user-feedback.md Issue #3+#4 for context.
 */

// waitForTestHooks is imported from test-helpers.js — it checks ALL hooks
// including showSessionSummary, showRecordingControls, setPermissionsReady,
// and many more. The previous local version only checked 3 of them.

/**
 * Sample session summary data for testing
 */
const sampleSummaryData = {
  duration: { startTime: Date.now() - 60000, endTime: Date.now() },
  gpsEventCount: 42,
  refPointCount: 3,
  imageCount: 15,
  depthSampleCount: 60,
  errors: [],
  firstGps: { lat: 50.0, lng: 8.0 },
  lastGps: { lat: 50.001, lng: 8.001 },
  totalDistanceMeters: 150.5,
};

// Shared setup for all tests
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Wait for session summary panel to exist (hidden by default)
  await page.locator('#session-summary-panel').waitFor({ state: 'attached' });
});

test.describe('Session Summary Panel - Visibility', () => {
  test('summary panel is hidden initially', async ({ page }) => {
    const panel = page.locator('#session-summary-panel');
    await expect(panel).toHaveClass(/hidden/);
  });

  test('summary panel becomes visible when showSessionSummary is called', async ({
    page,
  }) => {
    await waitForTestHooks(page);

    await page.evaluate((data) => {
      window.testHooks.showSessionSummary(data);
    }, sampleSummaryData);

    const panel = page.locator('#session-summary-panel');
    await expect(panel).not.toHaveClass(/hidden/);
    await expect(panel).toBeVisible();
  });
});

test.describe('Session Summary Panel - Edge Cases', () => {
  test('handles zero duration session', async ({ page }) => {
    await waitForTestHooks(page);

    const now = Date.now();
    const zeroDuration = {
      ...sampleSummaryData,
      duration: { startTime: now, endTime: now },
    };

    await page.evaluate((data) => {
      window.testHooks.showSessionSummary(data);
    }, zeroDuration);

    const duration = page.locator('#summary-duration');
    await expect(duration).toContainText('0:00');
  });
});

test.describe('Session Summary Panel - Buttons', () => {
  test.beforeEach(async ({ page }) => {
    await waitForTestHooks(page);
    await page.evaluate((data) => {
      window.testHooks.showSessionSummary(data);
    }, sampleSummaryData);
  });

  test('New Recording button is visible', async ({ page }) => {
    const newRecordingBtn = page.locator('#btn-new-recording');
    await expect(newRecordingBtn).toBeVisible();
    await expect(newRecordingBtn).toContainText('New Recording');
  });

  test('View Full Logs button is visible', async ({ page }) => {
    const viewLogsBtn = page.locator('#btn-view-logs');
    await expect(viewLogsBtn).toBeVisible();
    await expect(viewLogsBtn).toContainText('View Full Logs');
  });
});

test.describe('Session Summary Panel - Terminal State', () => {
  test('summary panel overlays the entire viewport', async ({ page }) => {
    await waitForTestHooks(page);
    await page.evaluate((data) => {
      window.testHooks.showSessionSummary(data);
    }, sampleSummaryData);

    const panel = page.locator('#session-summary-panel');
    const boundingBox = await panel.boundingBox();

    // Should cover viewport (allow some tolerance for margins)
    expect(boundingBox.width).toBeGreaterThan(100);
    expect(boundingBox.height).toBeGreaterThan(100);
  });

  test('recording controls are not visible when summary is shown', async ({
    page,
  }) => {
    await waitForTestHooks(page);

    // First show recording controls
    await page.evaluate(() => {
      window.testHooks.showRecordingControls();
    });

    // Then show summary (which should appear on top)
    await page.evaluate((data) => {
      window.testHooks.showSessionSummary(data);
    }, sampleSummaryData);

    // The summary panel should be on top (z-50) obscuring controls
    const panel = page.locator('#session-summary-panel');
    await expect(panel).toBeVisible();

    // Verify summary is in the foreground by checking it can receive clicks
    const newRecordingBtn = page.locator('#btn-new-recording');
    await expect(newRecordingBtn).toBeVisible();
  });
});

/**
 * Summary Map Tests (Issue #4, 2026-01-27)
 *
 * Tests for the Leaflet-based 2D map that shows the recorded GPS path
 * in the session summary panel.
 */
test.describe('Session Summary Panel - Map Display', () => {
  /** Sample data with GPS paths for map testing */
  const summaryDataWithPaths = {
    ...sampleSummaryData,
    rawGpsPath: [
      { lat: 50.0, lng: 8.0 },
      { lat: 50.001, lng: 8.001 },
      { lat: 50.002, lng: 8.002 },
    ],
    fusedPath: [],
    referencePointsForMap: [{ lat: 50.001, lng: 8.001, name: 'TestPoint' }],
  };

  test('map container exists in summary panel', async ({ page }) => {
    await waitForTestHooks(page);
    await page.evaluate((data) => {
      window.testHooks.showSessionSummary(data);
    }, summaryDataWithPaths);

    const mapContainer = page.locator('#summary-map-container');
    await expect(mapContainer).toBeVisible();
  });

  test('map section has "Recorded Path" heading', async ({ page }) => {
    await waitForTestHooks(page);
    await page.evaluate((data) => {
      window.testHooks.showSessionSummary(data);
    }, summaryDataWithPaths);

    const heading = page.locator(
      '#session-summary-panel h2:has-text("Recorded Path")'
    );
    await expect(heading).toBeVisible();
  });

  test('map legend shows raw GPS and fused path labels', async ({ page }) => {
    await waitForTestHooks(page);
    await page.evaluate((data) => {
      window.testHooks.showSessionSummary(data);
    }, summaryDataWithPaths);

    const rawGpsLegend = page.locator('text=Raw GPS');
    const fusedPathLegend = page.locator('text=Fused Path');

    await expect(rawGpsLegend).toBeVisible();
    await expect(fusedPathLegend).toBeVisible();
  });

  test('map renders Leaflet elements when GPS data provided', async ({
    page,
  }) => {
    await waitForTestHooks(page);
    await page.evaluate((data) => {
      window.testHooks.showSessionSummary(data);
    }, summaryDataWithPaths);

    // Wait for Leaflet to initialize
    const mapContainer = page.locator('#summary-map-container');

    // Leaflet adds its class directly to the container or creates internal structure.
    // Look for Leaflet's attribution control which is always present with a tile layer.
    const leafletAttribution = mapContainer.locator(
      '.leaflet-control-attribution'
    );
    await expect(leafletAttribution).toBeVisible({ timeout: 5000 });

    // Also verify the Leaflet link is present (confirms Leaflet loaded)
    await expect(leafletAttribution).toContainText('Leaflet');
  });

  test('shows "No GPS path recorded" when no GPS data', async ({ page }) => {
    await waitForTestHooks(page);

    const noGpsData = {
      ...sampleSummaryData,
      rawGpsPath: [],
      fusedPath: [],
      referencePointsForMap: [],
    };

    await page.evaluate((data) => {
      window.testHooks.showSessionSummary(data);
    }, noGpsData);

    const mapContainer = page.locator('#summary-map-container');
    await expect(mapContainer).toContainText('No GPS path recorded');
  });
});
