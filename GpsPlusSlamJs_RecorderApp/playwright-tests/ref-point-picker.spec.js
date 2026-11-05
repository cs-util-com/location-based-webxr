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
