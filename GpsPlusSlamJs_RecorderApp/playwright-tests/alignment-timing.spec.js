import { test, expect } from './e2e-test.js';

/**
 * Alignment timing page - boot coverage.
 *
 * Why these tests matter: this page is opened ONCE, on a phone, outdoors, by
 * someone who cannot re-run a test suite. Everything that can be checked
 * before that moment should be. A boot failure (a renamed element id, a module
 * that throws on load, an entry the bundler does not build) is invisible to
 * every unit test - those run the module against jsdom, not the built page -
 * and would cost the trip.
 *
 * What this deliberately does NOT do: run a timing pass. There is no recording
 * fixture in this suite, and a timing figure from a CI container would say
 * nothing about a phone anyway.
 */

test.describe('Alignment timing page', () => {
  test('boots, prints its parameters and the device, and refuses to run empty', async ({
    page,
  }) => {
    await page.goto('/alignment-timing.html');

    // The page is usable the moment it loads: the parameters a reader needs to
    // interpret any figure are printed before anything is measured.
    const parameters = page.locator('#timing-parameters');
    await expect(parameters).toContainText('History ladder');
    await expect(parameters).toContainText('warm-up');

    const device = page.locator('#timing-device');
    await expect(device).toContainText('hardwareConcurrency');

    // The run button stays disabled until a recording is chosen - the only
    // input this page has.
    await expect(page.locator('#timing-run')).toBeDisabled();
    await expect(page.locator('#timing-status')).toContainText(
      'Choose a recording zip'
    );
  });

  test('offers the swept repeat counts', async ({ page }) => {
    await page.goto('/alignment-timing.html');
    const options = page.locator('#timing-repeats option');
    await expect(options).toHaveCount(3);
    await expect(page.locator('#timing-repeats')).toHaveValue('5');
  });
});
