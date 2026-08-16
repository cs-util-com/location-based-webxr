import { test, expect } from './e2e-test.js';
import { waitForTestHooksSubset } from './test-helpers.js';

/**
 * GPS Event Markers E2E Tests
 *
 * These tests verify the GPS event visualization integration is properly
 * wired up and accessible via test hooks. Since Playwright cannot run
 * actual WebXR sessions, we test the integration contract rather than
 * the actual 3D rendering.
 *
 * Why these tests matter:
 * - Ensure test hooks are exposed and callable
 * - Verify zero ref state management works
 * - Confirm clear functionality resets state
 * - Guard against regressions in the wiring between main.ts and visualizer
 *
 * What we CAN'T test here (covered by unit tests):
 * - Actual Three.js mesh creation (requires WebXR scene)
 * - Marker positioning in 3D space
 * - Alignment matrix transformations
 */

/**
 * Wait for GPS event visualizer test hooks to be available.
 * Uses the shared timeout constant from test-helpers.js.
 * @param {import('@playwright/test').Page} page
 */
async function waitForGpsVisualizerHooks(page) {
  await waitForTestHooksSubset(
    page,
    () =>
      window.testHooks?.getGpsEventVisualizerCounts &&
      window.testHooks?.setGpsEventVisualizerZeroRef &&
      window.testHooks?.clearGpsEventVisualizer
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.locator('#setup-modal').waitFor({ state: 'visible' });
  await waitForGpsVisualizerHooks(page);
});

test.describe('GPS Event Visualizer Test Hooks', () => {
  test('test hooks for GPS visualizer are exposed', async ({ page }) => {
    // Why this test matters: Ensures the test hooks are actually available
    // so other e2e tests can use them to verify behavior.
    const hooks = await page.evaluate(() => ({
      hasGetCounts:
        typeof window.testHooks.getGpsEventVisualizerCounts === 'function',
      hasSetZeroRef:
        typeof window.testHooks.setGpsEventVisualizerZeroRef === 'function',
      hasClear: typeof window.testHooks.clearGpsEventVisualizer === 'function',
    }));

    expect(hooks.hasGetCounts).toBe(true);
    expect(hooks.hasSetZeroRef).toBe(true);
    expect(hooks.hasClear).toBe(true);
  });

  test('getCounts returns zero initially', async ({ page }) => {
    // Why this test matters: Verifies initial state is clean
    const counts = await page.evaluate(() =>
      window.testHooks.getGpsEventVisualizerCounts()
    );

    expect(counts.raw).toBe(0);
    expect(counts.fused).toBe(0);
  });

  test('setZeroRef can be called without error', async ({ page }) => {
    // Why this test matters: Ensures the wiring between test hooks and
    // the visualizer module doesn't throw. We can't verify the actual
    // effect without a WebXR scene, but we can verify it doesn't crash.
    const result = await page.evaluate(() => {
      try {
        window.testHooks.setGpsEventVisualizerZeroRef(50.0, 8.0);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    expect(result.success).toBe(true);
  });

  test('clearGpsEventVisualizer resets state', async ({ page }) => {
    // Why this test matters: Ensures clear functionality resets the
    // visualizer state. This is called when starting a new recording.

    // First set a zero ref
    await page.evaluate(() => {
      window.testHooks.setGpsEventVisualizerZeroRef(50.0, 8.0);
    });

    // Clear the visualizer
    await page.evaluate(() => {
      window.testHooks.clearGpsEventVisualizer();
    });

    // Counts should be zero after clear
    const counts = await page.evaluate(() =>
      window.testHooks.getGpsEventVisualizerCounts()
    );

    expect(counts.raw).toBe(0);
    expect(counts.fused).toBe(0);
  });

  test('getCounts returns correct type structure', async ({ page }) => {
    // Why this test matters: Ensures the counts object has the expected
    // shape, guarding against API changes that would break consumers.
    const counts = await page.evaluate(() =>
      window.testHooks.getGpsEventVisualizerCounts()
    );

    expect(typeof counts).toBe('object');
    expect(typeof counts.raw).toBe('number');
    expect(typeof counts.fused).toBe('number');
    expect(typeof counts.snapshots).toBe('number');
    expect(Object.keys(counts).sort()).toEqual(['fused', 'raw', 'snapshots']);
  });
});
