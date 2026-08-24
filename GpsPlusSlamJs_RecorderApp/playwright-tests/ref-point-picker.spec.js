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

  test('modal is hidden by default', async ({ page }) => {
    const modal = page.locator('#ref-point-picker-modal');
    await expect(modal).toHaveClass(/hidden/);
  });

  test('modal contains expected structure when shown', async ({ page }) => {
    // Use the application's real showRefPointPicker function
    // which populates the modal with proper HTML and sets up handlers
    await page.evaluate(() => {
      const api = window.refPointPickerApi;
      if (api?.showRefPointPicker) {
        api.showRefPointPicker([]);
      }
    });

    const modal = page.locator('#ref-point-picker-modal');
    await expect(modal).not.toHaveClass(/hidden/);

    // Check for key elements
    await expect(page.locator('#ref-point-picker-input')).toBeVisible();
    await expect(page.locator('#ref-point-picker-cancel')).toBeVisible();
    await expect(page.locator('#ref-point-picker-confirm')).toBeVisible();
    await expect(page.locator('#ref-point-picker-list')).toBeVisible();
  });

  test('cancel button hides the modal', async ({ page }) => {
    // Hide setup modal so it doesn't block clicks
    await page.evaluate(() => {
      const setupModal = document.getElementById('setup-modal');
      setupModal?.classList.add('hidden');
    });

    // Use the application's real showRefPointPicker function
    // which sets up all event handlers properly
    await page.evaluate(() => {
      // The app exposes this API on window after initialization
      const api = window.refPointPickerApi;
      if (api?.showRefPointPicker) {
        // Start the picker (don't await - we'll interact with it)
        api.showRefPointPicker([]);
      }
    });

    const modal = page.locator('#ref-point-picker-modal');
    await expect(modal).not.toHaveClass(/hidden/);

    // Click cancel - this uses the application's real handler
    await page.locator('#ref-point-picker-cancel').click();

    // Modal should be hidden by the real application handler
    await expect(modal).toHaveClass(/hidden/);
  });

  test('input field accepts text', async ({ page }) => {
    // Use the application's real showRefPointPicker function
    await page.evaluate(() => {
      const api = window.refPointPickerApi;
      if (api?.showRefPointPicker) {
        api.showRefPointPicker([]);
      }
    });

    const input = page.locator('#ref-point-picker-input');
    await input.fill('Test Reference Point');
    await expect(input).toHaveValue('Test Reference Point');
  });

  test('confirm button with empty input keeps modal visible', async ({
    page,
  }) => {
    // Hide setup modal so it doesn't block clicks
    await page.evaluate(() => {
      const setupModal = document.getElementById('setup-modal');
      setupModal?.classList.add('hidden');
    });

    // Use the application's real showRefPointPicker function
    await page.evaluate(() => {
      const api = window.refPointPickerApi;
      if (api?.showRefPointPicker) {
        api.showRefPointPicker([]);
      }
    });

    const modal = page.locator('#ref-point-picker-modal');

    // Ensure input is empty (the real app clears it on show)
    const input = page.locator('#ref-point-picker-input');
    await input.clear();
    await expect(input).toHaveValue('');

    // Click confirm - the real application handler rejects empty input
    await page.locator('#ref-point-picker-confirm').click();

    // Modal should still be visible (empty names not allowed by real handler)
    await expect(modal).not.toHaveClass(/hidden/);
  });

  test('confirm button with valid input hides the modal', async ({ page }) => {
    // Hide setup modal so it doesn't block clicks
    await page.evaluate(() => {
      const setupModal = document.getElementById('setup-modal');
      setupModal?.classList.add('hidden');
    });

    // Use the application's real showRefPointPicker function
    await page.evaluate(() => {
      const api = window.refPointPickerApi;
      if (api?.showRefPointPicker) {
        api.showRefPointPicker([]);
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
        api.showRefPointPicker([]);
      }
    });

    await expect(
      page.getByRole('heading', { name: 'Mark Reference Point' })
    ).toBeVisible();
  });

  test('suggestions list shows "no existing" message when empty', async ({
    page,
  }) => {
    // Use the application's real showRefPointPicker function with empty array
    // to test the "no existing reference points" message
    await page.evaluate(() => {
      const api = window.refPointPickerApi;
      if (api?.showRefPointPicker) {
        api.showRefPointPicker([]);
      }
    });

    const list = page.locator('#ref-point-picker-list');
    await expect(list).toContainText('No existing reference points');
  });

  test('input placeholder gives usage hint', async ({ page }) => {
    // Use the application's real showRefPointPicker function
    await page.evaluate(() => {
      const api = window.refPointPickerApi;
      if (api?.showRefPointPicker) {
        api.showRefPointPicker([]);
      }
    });

    const input = page.locator('#ref-point-picker-input');
    const placeholder = await input.getAttribute('placeholder');
    expect(placeholder).toContain('Bench');
  });

  test('suggestions list displays existing ref point IDs', async ({ page }) => {
    // Show the picker with existing ref point IDs
    await page.evaluate(() => {
      const api = window.refPointPickerApi;
      if (api?.showRefPointPicker) {
        api.showRefPointPicker(['Bench Corner', 'Fountain', 'Tree Stump']);
      }
    });

    const list = page.locator('#ref-point-picker-list');

    // Should show the existing ref points as clickable buttons
    await expect(list.locator('button')).toHaveCount(3);
    await expect(list).toContainText('Bench Corner');
    await expect(list).toContainText('Fountain');
    await expect(list).toContainText('Tree Stump');
  });

  test('clicking a suggestion selects it and closes modal', async ({
    page,
  }) => {
    // Hide setup modal so it doesn't block clicks
    await page.evaluate(() => {
      const setupModal = document.getElementById('setup-modal');
      setupModal?.classList.add('hidden');
    });

    // Show the picker with existing ref point IDs
    await page.evaluate(() => {
      const api = window.refPointPickerApi;
      if (api?.showRefPointPicker) {
        api.showRefPointPicker(['Bench Corner', 'Fountain']);
      }
    });

    const modal = page.locator('#ref-point-picker-modal');
    await expect(modal).not.toHaveClass(/hidden/);

    // Click on the first suggestion - the real handler should close the modal
    const list = page.locator('#ref-point-picker-list');
    await list.locator('button').first().click();

    // Modal should be hidden after selecting a suggestion
    await expect(modal).toHaveClass(/hidden/);
  });

  test('typing in input filters suggestions list', async ({ page }) => {
    // Show the picker with existing ref point IDs
    await page.evaluate(() => {
      const api = window.refPointPickerApi;
      if (api?.showRefPointPicker) {
        api.showRefPointPicker([
          'Bench Corner',
          'Bench North',
          'Fountain',
          'Tree Stump',
        ]);
      }
    });

    const input = page.locator('#ref-point-picker-input');
    const list = page.locator('#ref-point-picker-list');

    // Initially should show all 4 suggestions
    await expect(list.locator('button')).toHaveCount(4);

    // Type 'Bench' to filter - real input handler should filter the list
    await input.fill('Bench');

    // Should now only show the 2 "Bench" entries
    await expect(list.locator('button')).toHaveCount(2);
    await expect(list).toContainText('Bench Corner');
    await expect(list).toContainText('Bench North');
  });
});
