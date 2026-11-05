import { test, expect } from './e2e-test.js';

/**
 * Reference Point Picker Modal Tests
 *
 * These tests verify the ref point picker modal behavior by using the
 * application's real showRefPointPicker function exposed on window.
 * This ensures we test actual application behavior, not mock event handlers.
 *
 * Why this test matters: The ref point picker is a critical UI component
 * that allows users to name reference points consistently across sessions.
 *
 * Architecture: The app exposes `window.refPointPickerApi.showRefPointPicker`
 * after initialization, allowing E2E tests to trigger the real modal behavior.
 */

test.describe('Reference Point Picker Modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the app to expose the refPointPickerApi (indicates initialization complete)
    await page.waitForFunction(
      () => window.refPointPickerApi?.showRefPointPicker
    );
  });

  test('confirm button with valid input hides the modal', async ({ page }) => {
    // Why: the one picker flow kept in the browser. The unit tests hold the
    // picker itself (ref-point-picker.test.ts); this holds that the page wires
    // it, which jsdom cannot see.
    // Hide setup modal so it doesn't block clicks
    await page.evaluate(() => {
      const setupModal = document.getElementById('setup-modal');
      setupModal?.classList.add('hidden');
    });

    // Use the application's real showRefPointPicker function
    await page.evaluate(() => {
      const api = window.refPointPickerApi;
      if (api?.showRefPointPicker) {
        api.showRefPointPicker();
      }
    });

    const modal = page.locator('#ref-point-picker-modal');
    const input = page.locator('#ref-point-picker-input');

    // Enter a valid name
    await input.fill('Fountain Corner');

    // Click confirm - the real application handler accepts valid input
    await page.locator('#ref-point-picker-confirm').click();

    // Modal should be hidden by the real application handler
    await expect(modal).toHaveClass(/hidden/);
  });

  test('heading displays correct text', async ({ page }) => {
    // Use the application's real showRefPointPicker function
    await page.evaluate(() => {
      const api = window.refPointPickerApi;
      if (api?.showRefPointPicker) {
        api.showRefPointPicker();
      }
    });

    await expect(
      page.getByRole('heading', { name: 'Mark Reference Point' })
    ).toBeVisible();
  });

  test('input placeholder gives usage hint', async ({ page }) => {
    // Use the application's real showRefPointPicker function
    await page.evaluate(() => {
      const api = window.refPointPickerApi;
      if (api?.showRefPointPicker) {
        api.showRefPointPicker();
      }
    });

    const input = page.locator('#ref-point-picker-input');
    const placeholder = await input.getAttribute('placeholder');
    expect(placeholder).toContain('Bench');
  });
});
