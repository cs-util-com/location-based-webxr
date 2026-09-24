import { test, expect } from "./e2e-test.js";
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
      // The debug objects and the motion trail (plan §26) each hang off their
      // own WEBXR_TO_NUE basis node under arWorldGroup, found by name.
      const top = window.__qrDemoTest.worldGroupChildren;
      const byName = (name) => top.find((o) => o.name === name);
      const kids = byName("qr-debug-basis")?.children ?? [];
      const trail = byName("qr-motion-trail-basis")?.children ?? [];
      return {
        topCount: top.length,
        kidCount: kids.length,
        lastVisible: kids[kids.length - 1]?.visible,
        trailVisible: trail[0]?.visible,
      };
    });
    // Two basis nodes; axis + cube under the debug one, revealed on lock; the
    // trail's line drawn once two locks have positions.
    expect(scene.topCount).toBe(2);
    expect(scene.kidCount).toBe(2);
    expect(scene.lastVisible).toBe(true);
    expect(scene.trailVisible).toBe(true);
    // A code that does not move reads "still" (the motion row, plan §26).
    await expect(page.getByTestId("hud-motion")).toHaveText("still");
  });
});

/**
 * Regression (post-PnP switch): full PnP needs a metric SIZE to solve a pose, so
 * when the depth-measured size never converges (noisy/non-planar depth → quality
 * below the accept threshold), the controller's "size exists" gate withholds the
 * WHOLE overlay. Unlike the old depth-fit path — which could place a pose-only
 * axis without a size — PnP cannot run at all, so the QR is detected every frame
 * but nothing is glued and the demo stays scanning. This pins that intentional
 * behaviour change.
 */
test.describe("QR-tracking demo — no overlay until a size exists (PnP needs scale)", () => {
  test.beforeEach(async ({ page }) => {
    await installQrDemoFakes(page, { planar: false });
  });

  test("withholds the overlay while the size stays unknown", async ({
    page,
  }) => {
    await bootQrDemo(page);
    await feedFrames(page, 12);

    // Size never converged → PnP never runs → no lock; HUD stays scanning.
    await expect(page.getByTestId("hud-status")).toContainText("Scanning");
    await expect(page.getByTestId("hud-lifecycle")).toHaveText("unknown");
    await expect(page.getByTestId("hud-size")).toHaveText("—");

    const scene = await page.evaluate(() => {
      // Objects hang off the debug view's basis node under arWorldGroup;
      // basis.children[0] = axis, [1] = cube (add order in createQrDebugView).
      const kids =
        window.__qrDemoTest.worldGroupChildren.find(
          (o) => o.name === "qr-debug-basis",
        )?.children ?? [];
      return {
        count: kids.length,
        axisVisible: kids[0]?.visible,
        cubeVisible: kids[1]?.visible,
      };
    });
    // The debug objects exist (created eagerly) but neither is revealed —
    // `update()` was never called because no pose was solved.
    expect(scene.count).toBe(2);
    expect(scene.axisVisible).toBe(false);
    expect(scene.cubeVisible).toBe(false);
  });
});
