import { test, expect } from './e2e-test.js';
import {
  fakeWebXRSupport,
  REQUIRED_TEST_HOOKS,
  TEST_HOOKS_TIMEOUT_MS,
} from './test-helpers.js';

/**
 * Test Hooks Verification
 *
 * Keeps the hook list every spec waits for equal to the hooks the app exposes.
 * What the hooks drive is unit-tested in src/ui/hud.test.ts and exercised end
 * to end by enter-ar-flow.spec.js.
 *
 * Why this test matters: a hook that goes missing silently hangs every spec
 * that waits for it. See docs/2026-01-23-e2e-test-problems.md for background.
 */

test.describe('Hook coverage guard', () => {
  // Why this describe exists AND must not use waitForTestHooks: this guard
  // verifies REQUIRED_TEST_HOOKS itself, so gating it behind the very wait it
  // guards makes it unreachable — a hook removed from the app hangs
  // waitForTestHooks in beforeEach (30 s × every spec) before the guard can
  // report. Exactly that happened when quality-review D-3 removed
  // setFolderSelected (88/204 specs down, 2026-07-11). The app assigns
  // window.testHooks as ONE object literal at module evaluation, so waiting
  // for the object to exist is enough — its key set is complete and stable.
  test.beforeEach(async ({ page }) => {
    await fakeWebXRSupport(page);
    await page.goto('/');
    await page.locator('#setup-modal').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !!window.testHooks, {
      timeout: TEST_HOOKS_TIMEOUT_MS,
    });
  });

  test('REQUIRED_TEST_HOOKS matches the exposed window.testHooks surface @pr', async ({
    page,
  }) => {
    // Why this test matters: waitForTestHooks derives from REQUIRED_TEST_HOOKS
    // (single source of truth in test-helpers.js). A hook added to main.ts but
    // not to the list makes specs using it flaky; a hook removed from main.ts
    // but not from the list hangs every waitForTestHooks caller. This guard
    // turns both drifts into ONE fast, precisely-worded failure.
    const exposedHooks = await page.evaluate(() =>
      Object.keys(window.testHooks)
    );

    for (const hook of exposedHooks) {
      expect(
        REQUIRED_TEST_HOOKS,
        `Hook '${hook}' is exposed but missing from REQUIRED_TEST_HOOKS ` +
          `(test-helpers.js) — waitForTestHooks would not wait for it, making ` +
          `specs that use it flaky. Add it to the list.`
      ).toContain(hook);
    }

    for (const hook of REQUIRED_TEST_HOOKS) {
      expect(
        exposedHooks,
        `Hook '${hook}' is in REQUIRED_TEST_HOOKS but not exposed by ` +
          `window.testHooks — waitForTestHooks hangs EVERY spec in beforeEach ` +
          `until this is fixed. Remove it from the list (or restore the hook ` +
          `in main.ts).`
      ).toContain(hook);
    }
  });
});
