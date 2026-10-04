// @ts-check
/**
 * The in-recording settings wheel (2026-09-02).
 *
 * Why this spec matters: the wheel is gated by a query parameter and mounted
 * into the AR overlay by main.ts wiring that no unit test executes. The two
 * things only a browser can prove are (1) that an ordinary URL renders NO
 * gear at all - the flag is the sole surface change - and (2) that with the
 * flag the gear exists, opens its panel, and a preset picked there reaches
 * the wheel's values (the dispatch side is unit-tested; the hook reads what
 * the wheel holds). The RECORDING state is reached through the existing
 * `showRecordingControls` hook, as `button-states.spec.js` does.
 */
import { test, expect } from '@playwright/test';
import { fakeWebXRSupport, waitForTestHooks } from './test-helpers.js';

test.describe('debug wheel', () => {
  test('is absent without the flag - no gear, and the hook reports null', async ({
    page,
  }) => {
    await fakeWebXRSupport(page);
    await page.goto('/');
    await waitForTestHooks(page);
    await page.evaluate(() => window.testHooks.showRecordingControls());
    await expect(page.locator('#btn-debug-wheel')).toHaveCount(0);
    const values = await page.evaluate(() =>
      window.testHooks.getDebugWheelValues()
    );
    expect(values).toBeNull();
  });

  test('with ?debug=1 the gear opens a panel and a preset change reaches the wheel', async ({
    page,
  }) => {
    await fakeWebXRSupport(page);
    await page.goto('/?debug=1');
    await waitForTestHooks(page);
    // Reach the recording HUD as the app does after Enter AR: the modal down,
    // the recording controls up. Without a real AR session these two hooks
    // are the state machine's public steps.
    await page.evaluate(() => {
      window.testHooks.hideSetupModal();
      window.testHooks.showRecordingControls();
    });

    const gear = page.locator('#btn-debug-wheel');
    await gear.waitFor({ state: 'visible' });
    const panel = page.locator('#debug-wheel-panel');
    await expect(panel).toBeHidden();
    await gear.click();
    await expect(panel).toBeVisible();
    await expect(panel.locator('#debug-wheel-readout')).toHaveText(
      'waiting for the first GPS fix'
    );

    // Untouched first: the hook must say so, because an untouched wheel
    // dispatches nothing.
    const before = await page.evaluate(() =>
      window.testHooks.getDebugWheelValues()
    );
    expect(before).toMatchObject({ presetId: 'shipped', touched: false });

    await panel.locator('#debug-wheel-preset').selectOption('w90');
    const after = await page.evaluate(() =>
      window.testHooks.getDebugWheelValues()
    );
    expect(after).toMatchObject({ presetId: 'w90', touched: true });

    // The gear is a real toggle, not a one-way open.
    await gear.click();
    await expect(panel).toBeHidden();
  });
});

test.describe('the sun check toggle (sun-overlay plan M3)', () => {
  // Why: the toggle, its safety note and the recorder glue are wired in
  // main.ts, which no unit test executes. Only a browser proves the box is
  // in the wheel, that enabling it shows the safety note in the overlay
  // root, and that declining leaves it off. The check itself needs a real
  // AR session (the field checklist), so the accepted path here only proves
  // the box stays on and no sun HUD appears without a session.
  const openWheel = async (page) => {
    await fakeWebXRSupport(page);
    await page.goto('/?debug=1');
    await waitForTestHooks(page);
    await page.evaluate(() => {
      window.testHooks.hideSetupModal();
      window.testHooks.showRecordingControls();
    });
    const gear = page.locator('#btn-debug-wheel');
    await gear.waitFor({ state: 'visible' });
    await gear.click();
    return page.locator('#debug-wheel-sun-check');
  };

  test('declining the safety note leaves the check off', async ({ page }) => {
    const box = await openWheel(page);
    await expect(box).not.toBeChecked();
    await box.click();
    const cancel = page.getByTestId('confirm-dialog-cancel');
    await cancel.waitFor({ state: 'visible' });
    await expect(page.locator('#app')).toContainText(
      'Never look at the sun directly'
    );
    await cancel.click();
    await expect(box).not.toBeChecked();
    await expect(box).toBeEnabled();
    await expect(page.locator('#sun-check')).toHaveCount(0);
  });

  test('accepting it turns the box on, with no sun HUD before an AR session', async ({
    page,
  }) => {
    const box = await openWheel(page);
    await box.click();
    const confirm = page.getByTestId('confirm-dialog-confirm');
    await confirm.waitFor({ state: 'visible' });
    await confirm.click();
    await expect(box).toBeChecked();
    await expect(box).toBeEnabled();
    await expect(page.locator('#sun-check')).toHaveCount(0);
  });
});
