import { test, expect } from './e2e-test.js';
import { fakeWebXRSupport } from './test-helpers.js';

/**
 * Button State Tests
 *
 * Why this test matters: Correct button states prevent user confusion
 * and ensure the app guides users through the proper workflow.
 */

test('the HUD sits at the top, the controls at the bottom, with a labelled Mark Point button', async ({
  page,
}) => {
  // Fake WebXR so app stays in recording mode (Playwright has no WebXR)
  await fakeWebXRSupport(page);
  await page.goto('/');
  // Wait for a key element that indicates the app is ready
  await page.locator('#btn-start').waitFor({ state: 'attached' });

  /**
   * Why this step matters (User feedback 2026-01-27 Issue #5):
   * Users found the "📍" emoji-only button unclear. Adding text
   * label "Mark Point" improves discoverability like the Stop button.
   */
  await test.step('the reference point button has a text label', async () => {
    const refButton = page.locator('#btn-ref-point');
    await expect(refButton).toContainText('📍');
    await expect(refButton).toContainText('Mark Point');
  });

  await test.step('the status display shows its text', async () => {
    const statusContainer = page.locator('#status');
    await expect(statusContainer).toBeAttached();
    await expect(statusContainer).toContainText('Status:');
  });

  await test.step('the controls and the HUD sit at the screen edges', async () => {
    const controls = page.locator('#controls');
    await expect(controls).toBeAttached();
    expect(
      await controls.evaluate((el) => window.getComputedStyle(el).bottom)
    ).toBe('0px');

    const hud = page.locator('#hud');
    await expect(hud).toBeAttached();
    expect(await hud.evaluate((el) => window.getComputedStyle(el).top)).toBe(
      '0px'
    );
  });
});
