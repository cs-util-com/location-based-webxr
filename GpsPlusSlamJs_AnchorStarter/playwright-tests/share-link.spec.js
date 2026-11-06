import { test, expect } from "./e2e-test.js";
import {
  installAnchorStarterFakes,
  bootAnchorStarter,
  pushGpsFix,
} from "./fakes.js";

/**
 * Tier 1 copy-link (share) e2e for the persistent-anchor starter.
 *
 * Why this suite matters (see
 * GpsPlusSlamJs_Docs/docs/2026-06-01-0447-anchor-starter-e2e-test-plan.md §6 Tier 1):
 * Once an anchor is saved into `?show=`, the user shares the page link to open
 * the same anchor on another device (decision F1). The copy-link button is the
 * only async-UX affordance in the app that has a real success/failure label
 * flip and a timed revert. These tests pin both outcomes plus the revert,
 * under a clock paused once the anchor is saved, so nothing waits out the 2 s
 * and a slow machine cannot revert the label before it is read (`REVERT_MS`
 * follows `main.ts`; a shorter fast-forward here fails, it cannot pass by
 * accident).
 *
 * The clipboard *contents* are asserted as a soft, secondary check (clipboard
 * access is environment-sensitive); the label flip is the primary contract.
 */

const SAMPLE_FIX = { lat: 48.20817, lon: 16.37381, altitude: 171, accuracy: 4 };

/** The label's revert delay in `main.ts`. */
const REVERT_MS = 2000;

/** Boot, push a fix, place the anchor, and wait until it is saved. */
async function placeAndSave(page) {
  await bootAnchorStarter(page);
  await pushGpsFix(page, SAMPLE_FIX);
  await page.getByTestId("place-button").click();
  await expect(page.getByTestId("place-button")).toHaveText("Saved ✓");
  await page.clock.pauseAt(Date.now() + 60_000);
}

test.describe("Anchor starter — Tier 1 copy-link sharing", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
  });

  test("confirms the copy and reverts to idle, even when clicked twice inside the window @pr", async ({
    page,
  }) => {
    await installAnchorStarterFakes(page);
    await placeAndSave(page);

    // The second click below changes no text, so nothing on the page says when
    // it is done and its timer is set; this count does. It rises before the
    // app's own continuation can be observed, in the same task.
    await page.evaluate(() => {
      const write = navigator.clipboard.writeText.bind(navigator.clipboard);
      window.__copies = 0;
      navigator.clipboard.writeText = (text) =>
        write(text).finally(() => {
          window.__copies += 1;
        });
    });

    const copyButton = page.getByTestId("copy-link-button");
    await expect(copyButton).toBeVisible();
    await copyButton.click();

    // In-progress → final: the label confirms the copy succeeded.
    await expect(copyButton).toHaveText("Link copied ✓");

    // Soft, secondary: the clipboard holds the shareable page link.
    const clipboard = await page
      .evaluate(() => navigator.clipboard.readText())
      .catch(() => null);
    if (clipboard !== null) {
      expect.soft(clipboard).toContain("show=");
    }

    // Regression: a second click used to capture the transient "Link copied ✓"
    // as the idle label, locking the button to it permanently after the timer.
    await copyButton.click();
    await expect.poll(() => page.evaluate(() => window.__copies)).toBe(2);
    await expect(copyButton).toHaveText("Link copied ✓");

    // The single (latest) timer must restore the idle affordance, not lock it.
    await page.clock.fastForward(REVERT_MS);
    await expect(copyButton).toHaveText("Copy link");
  });

  test("shows a fallback hint when clipboard write fails @pr", async ({
    page,
  }) => {
    await installAnchorStarterFakes(page, { failClipboard: true });
    await placeAndSave(page);

    const copyButton = page.getByTestId("copy-link-button");
    await copyButton.click();

    // Failure path surfaces an actionable fallback instead of silent failure.
    await expect(copyButton).toHaveText("Copy failed — long-press the link");

    // And it too reverts to the idle affordance afterwards.
    await page.clock.fastForward(REVERT_MS);
    await expect(copyButton).toHaveText("Copy link");
  });
});
