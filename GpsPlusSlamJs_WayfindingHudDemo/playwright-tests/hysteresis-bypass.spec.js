import { test, expect } from "./e2e-test.js";

/**
 * No-bypass e2e for the 2026-07-18 field report ("spawned spheres showed no
 * overlay; after looking away and back they suddenly had one, and not at
 * the configured show/hide point").
 *
 * The revised rule (framework wayfinding-placement, 2026-07-18): visibility
 * is a pure DISTANCE state machine, independent of view direction. A fresh
 * spawn beyond distanceMin shows its indicator immediately (even inside the
 * deadband); a deactivated target shows NOTHING — no ring and no arrow —
 * until distanceMax, so a glance away can no longer activate it (the
 * original prototype parity let hidden → off-screen-arrow → ring bypass the
 * activation threshold; unit repro pinned in wayfinding-placement.test.ts).
 *
 * This spec drives the REAL HUD through the reported look-away/look-back
 * loop in the desktop simulator via OrbitControls camera drags and asserts
 * the same-view status is IDENTICAL before and after the glance.
 */

test.describe("Wayfinding HUD demo — no hysteresis bypass via look-away (field repro, revised rule)", () => {
  test("a deactivated target stays hidden through a look-away/look-back cycle", async ({
    page,
  }) => {
    await page.goto("/");
    const status = page.getByTestId("hud-status");
    await expect(status).toContainText("targets 4");
    // Dismiss the mode screen so drags hit the canvas, not the panel.
    await page.keyboard.press("s");
    await expect(page.getByTestId("mode-screen")).toBeHidden();

    // Widen the deadband: hide below 15 m, show beyond 25 m. Spawn rule on
    // the fresh HUD: ahead (~19 m ≥ 15) = ring, right (~15.9 m) and
    // elevated (~16.3 m) = arrows, behind-left (~13.9 m < 15) = HIDDEN —
    // and it must STAY hidden until 25 m, no matter where we look.
    await page.getByTestId("distance-max").fill("25");
    await page.getByTestId("distance-min").fill("15");
    await expect(status).toContainText("rings 1");
    await expect(status).toContainText("arrows 2");
    await expect(status).toContainText("hidden 1");

    // "Look away": drag the camera ~180° (OrbitControls: Δθ = 2π·dx/height;
    // viewport height 720 → 360 px ≈ 180°). Active targets swap between
    // ring/arrow as they enter/leave the view, but the deactivated one must
    // remain hidden — the count never drops to 0.
    await page.mouse.move(640, 150);
    await page.mouse.down();
    await page.mouse.move(280, 150, { steps: 20 });
    await page.mouse.up();
    await expect(status).toContainText("hidden 1");

    // "Look back": the view returns to the start pose — and the status is
    // IDENTICAL to before the glance. No look-away activation.
    await page.mouse.move(640, 150);
    await page.mouse.down();
    await page.mouse.move(1000, 150, { steps: 20 });
    await page.mouse.up();
    await expect(status).toContainText("rings 1");
    await expect(status).toContainText("arrows 2");
    await expect(status).toContainText("hidden 1");
  });
});
