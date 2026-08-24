import { test, expect } from './e2e-test.js';
import { fakeWebXRSupport, waitForTestHooks } from './test-helpers.js';

/**
 * Toast E2E Tests
 *
 * WHY THIS FILE EXISTS. On 2026-08-24 this app's toast was rewritten onto the
 * framework's shared mechanism — a real change to a live UI — and the plan for
 * that work claimed the recorder's e2e suite was its second verification. A
 * review checked: of fifteen spec files, exactly one mentioned toasts, in a
 * comment, with no assertion. The 205 passing tests proved only that
 * `initToast()` at boot did not throw. They could not see an empty,
 * mispositioned, or never-attached toast.
 *
 * That is the shape of defect root `CLAUDE.md` records under the favicon 404:
 * only visible in the real app. So the gap is closed here rather than argued
 * away.
 *
 * What only a browser can show, and jsdom cannot:
 * - the element is really in the layout, at the size and place the Tailwind
 *   classes claim — jsdom computes no layout at all;
 * - the deferred text write really lands, against a real task queue rather
 *   than vitest's fake timers;
 * - the element is really gone after its linger, against a real clock.
 */

test.describe('Toast', () => {
  test.beforeEach(async ({ page }) => {
    // Fake WebXR so the app stays in recording mode and boots `#app`, which is
    // the overlay root the toast must mount inside.
    await fakeWebXRSupport(page);
    await page.goto('/');
    await page.locator('#setup-modal').waitFor({ state: 'visible' });
    await waitForTestHooks(page);
  });

  test('appears with its message, announces politely, and is really visible', async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.testHooks?.showToast('Save failed - check folder permissions', {
        severity: 'error',
        duration: 30_000,
      });
    });

    const toast = page.locator('#toast-container');
    await expect(toast).toBeVisible();
    // The text arrives one task after the element. `toHaveText` retries, so
    // this asserts the write actually lands rather than that it is synchronous.
    await expect(toast).toHaveText('Save failed - check folder permissions');

    // The announcement contract, which is the reason the rewrite happened: this
    // app's toast had no role and no aria-live before, so every message it
    // showed was silent to a screen reader.
    await expect(toast).toHaveAttribute('role', 'status');
    await expect(toast).toHaveAttribute('aria-live', 'polite');
    await expect(toast).toHaveClass(/toast-error/);

    // Really in the layout — a class list is not evidence of a laid-out box,
    // and jsdom cannot tell the difference.
    const box = await toast.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  test('mounts inside the #app overlay root, so it composites over AR', async ({
    page,
  }) => {
    // The 2026-06-16 D4 regression in its real form: under WebXR DOM Overlay
    // only `#app` and its descendants composite over the camera feed, so a
    // toast anywhere else fires and is never seen during a session.
    await page.evaluate(() => {
      window.testHooks?.showToast('In AR', { duration: 30_000 });
    });

    await page.locator('#toast-container').waitFor({ state: 'visible' });
    const insideApp = await page.evaluate(
      () =>
        document
          .getElementById('app')
          ?.contains(document.getElementById('toast-container')) ?? false
    );

    expect(insideApp).toBe(true);
  });

  test('goes away on its own, against a real clock', async ({ page }) => {
    // The unit suite drives this with fake timers, which cannot show that the
    // timer is armed against the real event loop at all.
    //
    // 2 s, not shorter: `toBeVisible` has to win a race against the toast's
    // own removal, and on a loaded runner the evaluate round-trip plus locator
    // resolution is not bounded. When the budget loses, the failure blames the
    // code under test ("the toast never appeared") for a harness stall. Both
    // assertions stay condition-based, so the test is no slower in practice.
    await page.evaluate(() => {
      window.testHooks?.showToast('Brief', { duration: 2_000 });
    });

    const toast = page.locator('#toast-container');
    await expect(toast).toBeVisible();
    await expect(toast).toHaveCount(0, { timeout: 5_000 });
  });

  test('replaces the previous message rather than stacking', async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.testHooks?.showToast('First', { duration: 30_000 });
      window.testHooks?.showToast('Second', { duration: 30_000 });
    });

    const toast = page.locator('#toast-container');
    await expect(toast).toHaveText('Second');
    await expect(toast).toHaveCount(1);
  });
});
