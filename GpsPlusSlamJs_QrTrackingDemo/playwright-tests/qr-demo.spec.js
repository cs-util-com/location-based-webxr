import { test, expect } from "@playwright/test";
import { installQrDemoFakes, bootQrDemo, feedFrames } from "./fakes.js";

/**
 * Tier 1 application flow for the QR-tracking demo, with the device seam faked
 * (real WebXR/camera/depth are absent in desktop Chromium). It covers the whole
 * point of the app: boot → per-frame detect + depth-size measurement → the
 * running median converges and the debug axis + cube get glued under
 * `arWorldGroup`. This is the desktop stand-in for the manual §5 on-device gate.
 */
test.describe("QR-tracking demo — measure + glue flow", () => {
  test.beforeEach(async ({ page }) => {
    await installQrDemoFakes(page);
  });

  test("starts scanning with no measured size yet", async ({ page }) => {
    await bootQrDemo(page);
    await expect(page.getByTestId("hud-status")).toContainText("Scanning");
    await expect(page.getByTestId("hud-size")).toHaveText("—");
    await expect(page.getByTestId("hud-lifecycle")).toHaveText("unknown");
  });

  test('measures the QR size from depth and converges to "estimated"', async ({
    page,
  }) => {
    await bootQrDemo(page);
    await feedFrames(page, 12);

    // The faked planar square is 0.2 m on a side, every frame → median 20.0 cm.
    await expect(page.getByTestId("hud-lifecycle")).toHaveText("estimated");
    await expect(page.getByTestId("hud-size")).toHaveText("20.0 cm");
    await expect(page.getByTestId("hud-spread")).toHaveText("±0 mm");
    await expect(page.getByTestId("hud-status")).toContainText("Locked");

    // The debug log records per-lock lines with a Δt cadence stamp.
    const log = page.getByTestId("debug-log");
    await expect(log).toContainText("estimated 20.0cm");
    await expect(log).toContainText("Δ"); // inter-lock cadence is shown
  });

  test("glues the debug axis + cube under arWorldGroup once locked", async ({
    page,
  }) => {
    await bootQrDemo(page);
    await feedFrames(page, 12);

    const scene = await page.evaluate(() => {
      // The debug objects hang off an internal WEBXR_TO_NUE basis node, which is
      // the single child added to arWorldGroup.
      const top = window.__qrDemoTest.worldGroupChildren;
      const kids = top[0]?.children ?? [];
      return {
        topCount: top.length,
        kidCount: kids.length,
        lastVisible: kids[kids.length - 1]?.visible,
      };
    });
    // One basis node under arWorldGroup; axis + cube under it; revealed on lock.
    expect(scene.topCount).toBe(1);
    expect(scene.kidCount).toBe(2);
    expect(scene.lastVisible).toBe(true);
  });
});

/**
 * Strict depth→size→PnP gate (Step-0 conversion): the PnP pose needs a physical
 * size, so when the depth-measured size never converges (noisy/non-planar depth →
 * quality below the accept threshold) NOTHING is placed — no lock, no axis, no
 * cube. This deliberately mirrors production (which blocks the solve on a `null`
 * size) and is the accepted reversal of the earlier §2.7 "axis appears before the
 * size converges" behavior (that was a demo-only nicety on the size-free depth-fit
 * pose). On a real device the lever is the size accumulator's quality threshold.
 */
test.describe("QR-tracking demo — strict size gate withholds the pose until size converges", () => {
  test.beforeEach(async ({ page }) => {
    await installQrDemoFakes(page, { planar: false });
  });

  test("places nothing while the size stays unknown (no lock, no axis, no cube)", async ({
    page,
  }) => {
    await bootQrDemo(page);
    await feedFrames(page, 12);

    // Size never converged → strict gate never solves the pose → never locks.
    await expect(page.getByTestId("hud-status")).toContainText("Scanning");
    await expect(page.getByTestId("hud-lifecycle")).toHaveText("unknown");
    await expect(page.getByTestId("hud-size")).toHaveText("—");

    const scene = await page.evaluate(() => {
      // The basis node + axis + cube are created at boot but start hidden; with
      // no lock, update() is never called, so both stay hidden.
      const kids = window.__qrDemoTest.worldGroupChildren[0]?.children ?? [];
      return {
        count: kids.length,
        axisVisible: kids[0]?.visible,
        cubeVisible: kids[1]?.visible,
      };
    });
    expect(scene.count).toBe(2);
    expect(scene.axisVisible).toBe(false);
    expect(scene.cubeVisible).toBe(false);
  });
});
