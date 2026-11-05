import { test, expect } from './e2e-test.js';
import { fakeWebXRSupport } from './test-helpers.js';

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

// Shared setup for all tests - wait for app to be ready
test.beforeEach(async ({ page }) => {
  // Fake WebXR so app stays in recording mode (Playwright has no WebXR)
  await fakeWebXRSupport(page);
  await page.goto('/');
  // Wait for a key element that indicates the app is ready
  await page.locator('#btn-start').waitFor({ state: 'attached' });
});

test.describe('Recording Controls Button States', () => {
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
});

test.describe('HUD Display Elements', () => {
  test('status display shows status text', async ({ page }) => {
    const statusContainer = page.locator('#status');
    await expect(statusContainer).toBeAttached();
    await expect(statusContainer).toContainText('Status:');
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
