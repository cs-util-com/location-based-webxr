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
 * - the element is really gone after its linger, on the page's own timers.
 */

test.describe('Toast', () => {
  test('appears, announces politely, composites over AR, replaces the previous message and goes away on its own @pr', async ({
    page,
  }) => {
    // The clock keeps running after install, so the boot and the deferred text
    // write are real; it only lets the linger below be fast-forwarded.
    await page.clock.install();
    // Fake WebXR so the app stays in recording mode and boots `#app`, which is
    // the overlay root the toast must mount inside.
    await fakeWebXRSupport(page);
    await page.goto('/');
    await page.locator('#setup-modal').waitFor({ state: 'visible' });
    await waitForTestHooks(page);

    const toast = page.locator('#toast-container');

    await test.step('appears with its message, announces politely, is really visible', async () => {
      await page.evaluate(() => {
        window.testHooks?.showToast('Save failed - check folder permissions', {
          severity: 'error',
          duration: 30_000,
        });
      });

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

    await test.step('mounts inside the #app overlay root, so it composites over AR', async () => {
      // The 2026-06-16 D4 regression in its real form: under WebXR DOM Overlay
      // only `#app` and its descendants composite over the camera feed, so a
      // toast anywhere else fires and is never seen during a session.
      const insideApp = await page.evaluate(
        () =>
          document
            .getElementById('app')
            ?.contains(document.getElementById('toast-container')) ?? false
      );

      expect(insideApp).toBe(true);
    });

    await test.step('replaces the previous message rather than stacking', async () => {
      await page.evaluate(() => {
        window.testHooks?.showToast('First', { duration: 30_000 });
        window.testHooks?.showToast('Second', { duration: 30_000 });
      });

      await expect(toast).toHaveText('Second');
      await expect(toast).toHaveCount(1);
    });

    await test.step('goes away on its own', async () => {
      // The unit suite drives this with fake timers and no real page, which
      // cannot show that the timer is armed on the page at all.
      await page.evaluate(() => {
        window.testHooks?.showToast('Brief', { duration: 2_000 });
      });

      await expect(toast).toHaveText('Brief');
      await page.clock.fastForward(2_000);
      await expect(toast).toHaveCount(0, { timeout: 5_000 });
    });
  });
});
