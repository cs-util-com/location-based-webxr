import { test, expect } from './e2e-test.js';
import { fakeWebXRSupport, waitForTestHooksSubset } from './test-helpers.js';

/**
 * Button State Tests
 *
 * These tests verify that buttons enable/disable correctly based on
 * the application state. This ensures users can't perform invalid
 * actions and get clear visual feedback.
 *
 * Why this test matters: Correct button states prevent user confusion
 * and ensure the app guides users through the proper workflow.
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
      window.testHooks?.showRecordingControls &&
      window.testHooks?.hideRecordingControls
  );
}

// Shared setup for all tests - wait for app to be ready
test.beforeEach(async ({ page }) => {
  // Fake WebXR so app stays in recording mode (Playwright has no WebXR)
  await fakeWebXRSupport(page);
  await page.goto('/');
  // Wait for a key element that indicates the app is ready
  await page.locator('#btn-start').waitFor({ state: 'attached' });
});

test.describe('Recording Controls Button States', () => {
  test('start recording button exists', async ({ page }) => {
    const startButton = page.locator('#btn-start');
    await expect(startButton).toBeAttached();
    await expect(startButton).toContainText('Start Recording');
  });

  test('stop recording button exists but is hidden initially', async ({
    page,
  }) => {
    const stopButton = page.locator('#btn-stop');
    await expect(stopButton).toBeAttached();
    await expect(stopButton).toHaveClass(/hidden/);
  });

  test('reference point button exists but is hidden initially', async ({
    page,
  }) => {
    const refButton = page.locator('#btn-ref-point');
    await expect(refButton).toBeAttached();
    await expect(refButton).toHaveClass(/hidden/);
  });

  /**
   * Why this test matters (User feedback 2026-01-27 Issue #5):
   * Users found the "📍" emoji-only button unclear. Adding text
   * label "Mark Point" improves discoverability like the Stop button.
   */
  test('reference point button has text label for discoverability', async ({
    page,
  }) => {
    const refButton = page.locator('#btn-ref-point');
    await expect(refButton).toContainText('📍');
    await expect(refButton).toContainText('Mark Point');
  });

  test('map toggle button is visible', async ({ page }) => {
    const mapButton = page.locator('#btn-map');
    await expect(mapButton).toBeVisible();
    await expect(mapButton).toContainText('🗺️');
  });

  test('showRecordingControls shows/hides buttons correctly', async ({
    page,
  }) => {
    // Call the real showRecordingControls function via testHooks
    await waitForTestHooks(page);
    await page.evaluate(() => {
      window.testHooks.showRecordingControls();
    });

    // Verify button visibility changed
    const startButton = page.locator('#btn-start');
    const stopButton = page.locator('#btn-stop');
    const refButton = page.locator('#btn-ref-point');

    await expect(startButton).toHaveClass(/hidden/);
    await expect(stopButton).not.toHaveClass(/hidden/);
    await expect(refButton).not.toHaveClass(/hidden/);
  });

  test('hideRecordingControls restores buttons', async ({ page }) => {
    // First show recording controls
    await waitForTestHooks(page);
    await page.evaluate(() => {
      window.testHooks.showRecordingControls();
    });

    // Then hide recording controls
    await page.evaluate(() => {
      window.testHooks.hideRecordingControls();
    });

    // Verify buttons restored
    const startButton = page.locator('#btn-start');
    const stopButton = page.locator('#btn-stop');
    const refButton = page.locator('#btn-ref-point');

    await expect(startButton).not.toHaveClass(/hidden/);
    await expect(stopButton).toHaveClass(/hidden/);
    await expect(refButton).toHaveClass(/hidden/);
  });

  test('recording indicator is hidden initially', async ({ page }) => {
    const indicator = page.locator('#recording-indicator');
    await expect(indicator).toHaveClass(/hidden/);
  });

  test('recording indicator shows when showRecordingControls is called', async ({
    page,
  }) => {
    // Call the real showRecordingControls function which also shows the indicator
    await waitForTestHooks(page);
    await page.evaluate(() => {
      window.testHooks.showRecordingControls();
    });

    const indicator = page.locator('#recording-indicator');
    await expect(indicator).toHaveClass(/animate-pulse/);
    await expect(indicator).toHaveClass(/bg-red-500/);
  });
});

test.describe('Button Styling and Appearance', () => {
  test('start button has red background', async ({ page }) => {
    const startButton = page.locator('#btn-start');
    await expect(startButton).toHaveClass(/bg-red-600/);
  });

  test('stop button has red background for urgency', async ({ page }) => {
    const stopButton = page.locator('#btn-stop');
    await expect(stopButton).toHaveClass(/bg-red-600/);
  });

  test('ref point button has blue background', async ({ page }) => {
    const refButton = page.locator('#btn-ref-point');
    await expect(refButton).toHaveClass(/bg-blue-600/);
  });

  test('map button pill has gray background', async ({ page }) => {
    const mapPill = page.locator('#btn-map').locator('..');
    await expect(mapPill).toHaveClass(/bg-gray-700/);
  });

  test('buttons have rounded styling', async ({ page }) => {
    const startButton = page.locator('#btn-start');
    const mapPill = page.locator('#btn-map').locator('..');

    await expect(startButton).toHaveClass(/rounded-full/);
    await expect(mapPill).toHaveClass(/rounded-xl/);
  });

  test('enter AR button has correct disabled styling', async ({ page }) => {
    const enterButton = page.locator('#btn-enter-ar');
    await expect(enterButton).toBeDisabled();
    await expect(enterButton).toHaveClass(/disabled:bg-gray-600/);
  });
});

test.describe('HUD Display Elements', () => {
  test('status display shows status text', async ({ page }) => {
    const statusContainer = page.locator('#status');
    await expect(statusContainer).toBeAttached();
    await expect(statusContainer).toContainText('Status:');
  });

  test('GPS info section exists but may be hidden', async ({ page }) => {
    const gpsInfo = page.locator('#gps-info');
    await expect(gpsInfo).toBeAttached();
    // Hidden initially (shown when GPS is active)
    await expect(gpsInfo).toHaveClass(/hidden/);
  });

  test('AR info section exists but may be hidden', async ({ page }) => {
    const arInfo = page.locator('#ar-info');
    await expect(arInfo).toBeAttached();
    // Hidden initially (shown when AR is active)
    await expect(arInfo).toHaveClass(/hidden/);
  });

  test('updateGpsInfo shows GPS info with accuracy', async ({ page }) => {
    // Call the real updateGpsInfo function which shows GPS info and sets accuracy
    await waitForTestHooks(page);
    await page.evaluate(() => {
      window.testHooks.updateGpsInfo(5);
    });

    const gpsInfo = page.locator('#gps-info');
    await expect(gpsInfo).not.toHaveClass(/hidden/);
    await expect(gpsInfo).toContainText('GPS:');

    const accuracy = page.locator('#gps-accuracy');
    await expect(accuracy).toContainText('±5.0m');
  });

  test('updateArInfo shows AR info with tracking status', async ({ page }) => {
    // Call the real updateArInfo function which shows AR info and sets status
    await waitForTestHooks(page);
    await page.evaluate(() => {
      window.testHooks.updateArInfo('Tracking');
    });

    const arInfo = page.locator('#ar-info');
    await expect(arInfo).not.toHaveClass(/hidden/);
    await expect(arInfo).toContainText('AR:');

    const tracking = page.locator('#ar-tracking');
    await expect(tracking).toContainText('Tracking');
  });

  test('HUD has semi-transparent background', async ({ page }) => {
    const hudBox = page.locator('#hud > div').first();
    await expect(hudBox).toHaveClass(/bg-black\/60/);
  });
});

test.describe('Controls Layout', () => {
  test('controls are positioned at bottom of screen', async ({ page }) => {
    const controls = page.locator('#controls');
    await expect(controls).toBeAttached();

    const position = await controls.evaluate(
      (el) => window.getComputedStyle(el).bottom
    );
    expect(position).toBe('0px');
  });

  test('HUD is positioned at top of screen', async ({ page }) => {
    const hud = page.locator('#hud');
    await expect(hud).toBeAttached();

    const position = await hud.evaluate(
      (el) => window.getComputedStyle(el).top
    );
    expect(position).toBe('0px');
  });

  test('controls container has flex layout', async ({ page }) => {
    // Target the flex layout row specifically: #controls also holds the
    // (hidden) #ref-point-hint banner (D3), so a bare `#controls > div`
    // locator now matches two elements.
    const controlsInner = page.locator('#controls > div.flex');
    await expect(controlsInner).toHaveClass(/flex/);
    await expect(controlsInner).toHaveClass(/justify-between/);
  });
});
