import { test, expect } from './e2e-test.js';
import { fakeWebXRSupport } from './test-helpers.js';

/**
 * Smoke tests for the Recorder App.
 *
 * These tests verify the app loads and renders correctly in a desktop browser.
 * WebXR functionality cannot be tested here - that requires a real Android device.
 */

/**
 * Check if an error message is WebXR-related.
 * WebXR errors are expected in desktop browsers and should be ignored.
 */
const isWebXrError = (text) =>
  text.toLowerCase().includes('webxr') || text.toLowerCase().includes('xr');

test.describe('Recorder App Smoke Tests', () => {
  // Fake WebXR so app stays in recording mode (Playwright has no WebXR)
  test.beforeEach(async ({ page }) => {
    await fakeWebXRSupport(page);
  });

  test('loads without console errors', async ({ page }) => {
    const consoleIssues = [];
    const pageErrors = [];
    const allowedWarningPatterns = [
      /cdn\.tailwindcss\.com should not be used in production/i,
      // WebXR not supported is expected in desktop browser
      /WebXR/i,
    ];

    page.on('console', (message) => {
      const type = message.type();
      const text = message.text();

      if (type === 'error') {
        // Allow WebXR-related errors since we're not on a real device
        if (!isWebXrError(text)) {
          consoleIssues.push({ type, text });
        }
      } else if (type === 'warning') {
        const isAllowed = allowedWarningPatterns.some((pattern) =>
          pattern.test(text)
        );
        if (!isAllowed) {
          consoleIssues.push({ type, text });
        }
      }
    });

    page.on('pageerror', (error) => {
      // Allow WebXR-related errors
      if (!isWebXrError(error.message)) {
        pageErrors.push(error.message);
      }
    });

    const response = await page.goto('/');

    expect(response, 'Expected to receive a valid response').not.toBeNull();
    if (response) {
      expect
        .soft(response.status(), 'Expected successful status code')
        .toBeLessThan(400);
    }

    // Wait for the setup modal to be visible (indicates app fully loaded)
    await page.locator('#setup-modal').waitFor({ state: 'visible' });

    expect(consoleIssues, 'Console errors detected').toEqual([]);
    expect(pageErrors, 'Page errors detected').toEqual([]);
  });

  test('shows setup modal on load', async ({ page }) => {
    await page.goto('/');

    // The setup modal should be visible
    const setupModal = page.locator('#setup-modal');
    await expect(setupModal).toBeVisible();

    // Title should be present
    await expect(
      page.getByRole('heading', { name: 'GPS + SLAM Recorder' })
    ).toBeVisible();
  });

  test('setup modal has required UI elements', async ({ page }) => {
    await page.goto('/');

    // Storage setup section should be visible with mandatory buttons (Task 1a-fix)
    const storageSetup = page.locator('#storage-setup');
    await expect(storageSetup).toBeVisible();

    // The save location is the mandatory storage step and is visible by default.
    // The folder-import step is an optional collapsed section (D5), so its
    // button is present but hidden until expanded.
    const openFolderBtn = page.locator('#btn-open-folder');
    await expect(openFolderBtn).toBeAttached();
    await expect(openFolderBtn).toContainText('Open Previous Recordings');

    // Choose save location button should be visible
    const chooseSaveBtn = page.locator('#btn-choose-save');
    await expect(chooseSaveBtn).toBeVisible();
    await expect(chooseSaveBtn).toContainText('Choose Save Location');

    // Scenario dropdown lives in the collapsed scenario/session section (D6
    // item 3), so it is present but hidden until the section is expanded.
    const scenarioSelect = page.locator('#scenario-select');
    await expect(scenarioSelect).toBeAttached();
    await page.evaluate(() => {
      const section = document.getElementById('scenario-section');
      if (section) section.open = true;
    });
    await expect(scenarioSelect).toBeVisible();

    // Enter AR button (initially disabled)
    const enterButton = page.locator('#btn-enter-ar');
    await expect(enterButton).toBeVisible();
    await expect(enterButton).toBeDisabled();
  });

  test('HUD elements exist but may be hidden', async ({ page }) => {
    await page.goto('/');

    // HUD should exist in DOM
    const hud = page.locator('#hud');
    await expect(hud).toBeAttached();

    // Status display should exist
    const status = page.locator('#status-text');
    await expect(status).toBeAttached();
  });

  test('control buttons exist', async ({ page }) => {
    await page.goto('/');

    // Map toggle button should be visible
    const mapButton = page.locator('#btn-map');
    await expect(mapButton).toBeVisible();

    // Recording buttons should exist (may be hidden initially)
    const startButton = page.locator('#btn-start');
    await expect(startButton).toBeAttached();
  });
});
