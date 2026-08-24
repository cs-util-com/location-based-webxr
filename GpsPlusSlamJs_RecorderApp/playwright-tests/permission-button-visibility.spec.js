import { test, expect } from './e2e-test.js';
import { fakeWebXRSupport, waitForTestHooks } from './test-helpers.js';

/**
 * Permission button visibility (Issue 2 of
 * docs/2026-05-03-setup-screen-defaults-and-permission-rerequest.md).
 *
 * Why this test matters: When a user lands on the setup modal with denied
 * permissions, the "Grant Permissions" button must remain visible so they
 * can re-request after flipping a permission in browser settings. The bug
 * was that the button only showed for `granted === null` and disappeared as
 * soon as anything was denied, leaving the user stuck.
 */

test.beforeEach(async ({ page }) => {
  await fakeWebXRSupport(page);
  await page.goto('/');
  await page.locator('#setup-modal').waitFor({ state: 'visible' });
  await waitForTestHooks(page);
});

test.describe('Grant Permissions button visibility', () => {
  test('stays visible when a mandatory permission is denied', async ({
    page,
  }) => {
    // Simulate the real callback from a permission-state change: the user
    // denied Location, kept everything else pending. The button must remain
    // visible so the user can retry after fixing browser settings.
    await page.evaluate(() => {
      window.testHooks.updatePermissionStatus({
        allMandatoryReady: false,
        webxr: { granted: true, supported: true },
        geolocation: { granted: false, supported: true, error: 'denied' },
        camera: { granted: null, supported: true },
        orientation: { granted: null, supported: true },
        fileSystem: { granted: null, supported: true },
      });
    });

    const btn = page.locator('#btn-request-permissions');
    await expect(btn).toBeVisible();

    // Permission-error block should communicate why permissions are still
    // outstanding (denied messages take precedence over the generic hint).
    const error = page.locator('#permission-error');
    await expect(error).toContainText(/Location access denied/i);
  });

  test('hides only after every mandatory permission reports granted', async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.testHooks.updatePermissionStatus({
        allMandatoryReady: true,
        webxr: { granted: true, supported: true },
        geolocation: { granted: true, supported: true },
        camera: { granted: true, supported: true },
        orientation: { granted: true, supported: true },
        fileSystem: { granted: true, supported: true },
      });
    });

    const btn = page.locator('#btn-request-permissions');
    await expect(btn).toBeHidden();
  });
});
