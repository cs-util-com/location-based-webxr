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

    // The debug log records per-frame diagnostics: depth coverage, the size,
    // the lifecycle stage, and the verdict — with a Δt cadence stamp.
    const log = page.getByTestId("debug-log");
    await expect(log).toContainText("d4/4"); // all 4 corners had depth
    await expect(log).toContainText("20.0cm"); // measured size
    await expect(log).toContainText("estimated"); // lifecycle stage
    await expect(log).toContainText("solved"); // PnP placed it
    await expect(log).toContainText("Δ"); // inter-frame cadence is shown
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
 * `depth → size → PnP` gate (Step-0 conversion): the PnP pose needs a physical
 * size, so when NO size can be measured at all — noisy/non-planar depth keeps every
 * observation's quality below the accept threshold, so the accumulator never takes
 * a sample and `estimateM` stays `null` — NOTHING is placed: no lock, no axis, no
 * cube. This mirrors production, which blocks the solve on a `null` size. Note the
 * gate is "a size EXISTS", not "the size has converged to `estimated`": once even a
 * single sample is accepted the overlay is placed with that provisional median (the
 * `estimated` lifecycle gates only the high-weight GPS vote, never cast here).
 */
test.describe("QR-tracking demo — gate withholds the pose until a size can be measured", () => {
  test.beforeEach(async ({ page }) => {
    await installQrDemoFakes(page, { planar: false });
  });

  test("places nothing while no size can be measured (no lock, no axis, no cube)", async ({
    page,
  }) => {
    await bootQrDemo(page);
    await feedFrames(page, 12);

    // No sample ever accepted → estimateM stays null → gate never solves → no lock.
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
