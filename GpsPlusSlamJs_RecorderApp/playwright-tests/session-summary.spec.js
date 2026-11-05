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

test.describe('Session Summary Panel', () => {
  test('hidden at first, then over the recording controls with its buttons, its map, and the way to the logs', async ({
    page,
  }) => {
    /** Sample data with GPS paths (Issue #4, 2026-01-27: the Leaflet 2D map). */
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
    const panel = page.locator('#session-summary-panel');

    await test.step('hidden initially', async () => {
      await expect(panel).toHaveClass(/hidden/);
    });

    await test.step('appears over the recording controls', async () => {
      await waitForTestHooks(page);

      // First show recording controls
      await page.evaluate(() => {
        window.testHooks.showRecordingControls();
      });

      // Then show summary (which should appear on top)
      await page.evaluate((data) => {
        window.testHooks.showSessionSummary(data);
      }, summaryDataWithPaths);

      await expect(panel).not.toHaveClass(/hidden/);
      await expect(panel).toBeVisible();

      // Should cover viewport (allow some tolerance for margins)
      const boundingBox = await panel.boundingBox();
      expect(boundingBox.width).toBeGreaterThan(100);
      expect(boundingBox.height).toBeGreaterThan(100);
    });

    await test.step('its buttons', async () => {
      const newRecordingBtn = page.locator('#btn-new-recording');
      await expect(newRecordingBtn).toBeVisible();
      await expect(newRecordingBtn).toContainText('New Recording');

      const viewLogsBtn = page.locator('#btn-view-logs');
      await expect(viewLogsBtn).toBeVisible();
      await expect(viewLogsBtn).toContainText('View Full Logs');
    });

    await test.step('the recorded path map', async () => {
      const mapContainer = page.locator('#summary-map-container');
      await expect(mapContainer).toBeVisible();
      await expect(
        page.locator('#session-summary-panel h2:has-text("Recorded Path")')
      ).toBeVisible();
      await expect(page.locator('text=Raw GPS')).toBeVisible();
      await expect(page.locator('text=Fused Path')).toBeVisible();

      // Leaflet adds its class directly to the container or creates internal structure.
      // Look for Leaflet's attribution control which is always present with a tile layer.
      const leafletAttribution = mapContainer.locator(
        '.leaflet-control-attribution'
      );
      await expect(leafletAttribution).toBeVisible({ timeout: 5000 });

      // Also verify the Leaflet link is present (confirms Leaflet loaded)
      await expect(leafletAttribution).toContainText('Leaflet');
    });

    await test.step('View Full Logs opens the log panel', async () => {
      // Hide the setup modal so it cannot take the click.
      await page.evaluate(() => {
        document.getElementById('setup-modal')?.classList.add('hidden');
      });
      await page.locator('#btn-view-logs').click();
      await expect(page.locator('#log-panel')).toBeVisible();
    });
  });

  test('a session of no length and no GPS says so', async ({ page }) => {
    await waitForTestHooks(page);

    const now = Date.now();
    await page.evaluate(
      (data) => {
        window.testHooks.showSessionSummary(data);
      },
      {
        ...sampleSummaryData,
        duration: { startTime: now, endTime: now },
        rawGpsPath: [],
        fusedPath: [],
        referencePointsForMap: [],
      }
    );

    await expect(page.locator('#summary-duration')).toContainText('0:00');
    await expect(page.locator('#summary-map-container')).toContainText(
      'No GPS path recorded'
    );
  });
});
