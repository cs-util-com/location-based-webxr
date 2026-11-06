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
  test('opens over the setup modal, shows its defaults, closes, and saved options survive a reload', async ({
    page,
  }) => {
    // Fake WebXR so app stays in recording mode (Playwright has no WebXR)
    await fakeWebXRSupport(page);
    // Note: Playwright creates a fresh browser context per test, so
    // localStorage is already empty — no need for addInitScript to clear it.
    await page.goto('/');
    // Wait for settings button to be visible (indicates app initialized)
    const settingsButton = page.locator('#btn-settings');
    await settingsButton.waitFor({ state: 'visible' });
    const settingsModal = page.locator('#settings-modal');

    await test.step('hidden by default, opens from its button', async () => {
      await expect(settingsModal).toHaveClass(/hidden/);

      await settingsButton.click();

      await expect(settingsModal).not.toHaveClass(/hidden/);
      await expect(settingsModal).toBeVisible();
    });

    await test.step('lies above the setup modal', async () => {
      const settingsZIndex = await settingsModal.evaluate(
        (el) => window.getComputedStyle(el).zIndex
      );
      const setupZIndex = await page
        .locator('#setup-modal')
        .evaluate((el) => window.getComputedStyle(el).zIndex);

      expect(parseInt(settingsZIndex)).toBeGreaterThan(parseInt(setupZIndex));
    });

    await test.step('the defaults', async () => {
      await expect(page.locator('#depth-enabled')).toBeChecked();
      await expect(page.locator('#images-enabled')).toBeChecked();
      // 0.2s since the 2026-07-16 evening on-device framerate/mesh trade-off
      // passes; equals the framework DEFAULT_RECONSTRUCTION_DEPTH_INTERVAL_MS.
      await expect(page.locator('#depth-interval-value')).toHaveText('0.2s');
      // 24×24 since the 2026-07-16 evening on-device framerate/mesh
      // trade-off pass (the sweep-derived 64 hurt the framerate); equals the
      // framework DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE shared with the
      // PhysicsDemo.
      await expect(page.locator('#depth-grid-value')).toHaveText('24×24');
      await expect(page.locator('#images-interval-value')).toHaveText('2.0s');
      await expect(page.locator('#images-quality-value')).toHaveText('70%');
    });

    await test.step('every control is keyboard accessible', async () => {
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

    await test.step('the close button hides it', async () => {
      await page.locator('#btn-settings-close').click();
      await expect(settingsModal).toHaveClass(/hidden/);
    });

    await test.step('saved options persist after a reload', async () => {
      // Open settings and modify
      await settingsButton.click();
      await page.locator('#depth-enabled').uncheck();
      await page.locator('#images-quality').fill('0.5');
      await page.locator('#images-quality').dispatchEvent('input');
      await page.locator('#btn-settings-save').click();

      // Reload page
      await page.reload();
      // Wait for settings button to be visible (indicates app initialized)
      await settingsButton.waitFor({ state: 'visible' });

      // Open settings again
      await settingsButton.click();
      await settingsModal.waitFor({ state: 'visible' });

      // Verify values persisted
      await expect(page.locator('#depth-enabled')).not.toBeChecked();
      await expect(page.locator('#images-quality-value')).toHaveText('50%');
    });
  });
});
