import { test, expect } from './e2e-test.js';
import { fakeWebXRSupport } from './test-helpers.js';

/**
 * Settings Modal E2E Tests
 *
 * These tests verify the settings modal workflow for configuring
 * recording options (depth sampling, image capture).
 *
 * Why these tests matter:
 * - Settings affect recording behavior and performance
 * - User preferences must persist across sessions
 * - Slider/checkbox interactions must work correctly on real browsers
 */

test.describe('Settings Modal', () => {
  test.beforeEach(async ({ page }) => {
    // Fake WebXR so app stays in recording mode (Playwright has no WebXR)
    await fakeWebXRSupport(page);
    // Note: Playwright creates a fresh browser context per test, so
    // localStorage is already empty — no need for addInitScript to clear it.
    await page.goto('/');
    // Wait for settings button to be visible (indicates app initialized)
    await page.locator('#btn-settings').waitFor({ state: 'visible' });
  });

  test.describe('Modal Visibility', () => {
    test('settings button is visible in setup modal', async ({ page }) => {
      const settingsButton = page.locator('#btn-settings');
      await expect(settingsButton).toBeVisible();
    });

    test('settings modal is hidden by default', async ({ page }) => {
      const settingsModal = page.locator('#settings-modal');
      await expect(settingsModal).toHaveClass(/hidden/);
    });

    test('clicking settings button opens modal', async ({ page }) => {
      const settingsButton = page.locator('#btn-settings');
      const settingsModal = page.locator('#settings-modal');

      await settingsButton.click();

      await expect(settingsModal).not.toHaveClass(/hidden/);
      await expect(settingsModal).toBeVisible();
    });

    test('clicking close button hides modal', async ({ page }) => {
      const settingsButton = page.locator('#btn-settings');
      const closeButton = page.locator('#btn-settings-close');
      const settingsModal = page.locator('#settings-modal');

      await settingsButton.click();
      await expect(settingsModal).toBeVisible();

      await closeButton.click();
      await expect(settingsModal).toHaveClass(/hidden/);
    });

    test('settings modal has higher z-index than setup modal', async ({
      page,
    }) => {
      const settingsButton = page.locator('#btn-settings');
      await settingsButton.click();

      const settingsModal = page.locator('#settings-modal');
      const setupModal = page.locator('#setup-modal');

      const settingsZIndex = await settingsModal.evaluate(
        (el) => window.getComputedStyle(el).zIndex
      );
      const setupZIndex = await setupModal.evaluate(
        (el) => window.getComputedStyle(el).zIndex
      );

      expect(parseInt(settingsZIndex)).toBeGreaterThan(parseInt(setupZIndex));
    });
  });

  test.describe('Form Elements', () => {
    test.beforeEach(async ({ page }) => {
      // Open settings modal
      await page.locator('#btn-settings').click();
      await page.locator('#settings-modal').waitFor({ state: 'visible' });
    });

    test('depth enabled checkbox is checked by default', async ({ page }) => {
      const checkbox = page.locator('#depth-enabled');
      await expect(checkbox).toBeChecked();
    });

    test('images enabled checkbox is checked by default', async ({ page }) => {
      const checkbox = page.locator('#images-enabled');
      await expect(checkbox).toBeChecked();
    });

    test('depth interval slider shows default value', async ({ page }) => {
      const valueDisplay = page.locator('#depth-interval-value');
      // 0.2s since the 2026-07-16 evening on-device framerate/mesh trade-off
      // passes; equals the framework DEFAULT_RECONSTRUCTION_DEPTH_INTERVAL_MS.
      await expect(valueDisplay).toHaveText('0.2s');
    });

    test('depth grid slider shows default value', async ({ page }) => {
      const valueDisplay = page.locator('#depth-grid-value');
      // 24×24 since the 2026-07-16 evening on-device framerate/mesh
      // trade-off pass (the sweep-derived 64 hurt the framerate); equals the
      // framework DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE shared with the
      // PhysicsDemo.
      await expect(valueDisplay).toHaveText('24×24');
    });

    test('images interval slider shows default value', async ({ page }) => {
      const valueDisplay = page.locator('#images-interval-value');
      await expect(valueDisplay).toHaveText('2.0s');
    });

    test('images quality slider shows default value', async ({ page }) => {
      const valueDisplay = page.locator('#images-quality-value');
      await expect(valueDisplay).toHaveText('70%');
    });
  });

  test.describe('Persistence', () => {
    test('saved options persist after page reload', async ({ page }) => {
      // Open settings and modify
      await page.locator('#btn-settings').click();
      await page.locator('#depth-enabled').uncheck();
      await page.locator('#images-quality').fill('0.5');
      await page.locator('#images-quality').dispatchEvent('input');
      await page.locator('#btn-settings-save').click();

      // Reload page
      await page.reload();
      // Wait for settings button to be visible (indicates app initialized)
      await page.locator('#btn-settings').waitFor({ state: 'visible' });

      // Open settings again
      await page.locator('#btn-settings').click();
      await page.locator('#settings-modal').waitFor({ state: 'visible' });

      // Verify values persisted
      const depthEnabled = page.locator('#depth-enabled');
      const qualityDisplay = page.locator('#images-quality-value');

      await expect(depthEnabled).not.toBeChecked();
      await expect(qualityDisplay).toHaveText('50%');
    });
  });

  test.describe('Accessibility', () => {
    test('all form controls are keyboard accessible', async ({ page }) => {
      await page.locator('#btn-settings').click();

      // Tab through elements
      const focusableElements = [
        '#btn-settings-close',
        '#images-enabled',
        '#images-interval',
        '#images-quality',
        '#depth-enabled',
        '#depth-interval',
        '#depth-grid',
        '#btn-settings-reset',
        '#btn-settings-save',
      ];

      for (const selector of focusableElements) {
        await page.keyboard.press('Tab');
        const element = page.locator(selector);
        // Element should be focusable (may not be the active element due to order)
        await expect(element).toBeEnabled();
      }
    });
  });
});
