import { test, expect } from "./e2e-test.js";

/**
 * Walk-flow e2e — drives the REAL wayfinding HUD through its hysteresis
 * state machine with the keyboard.
 *
 * Why this suite matters: this is the only automated end-to-end proof of the
 * graduated HUD's headline behavior on a real render path (real three.js
 * camera, real placement math, real indicator meshes — no fakes): walking at
 * the ahead target hides its ring below distanceMin ("arrived"), walking
 * away keeps it hidden through the deadband and reactivates it only beyond
 * distanceMax, and the live sliders re-create the HUD with a new deadband.
 * The status line the assertions read is derived from the presenter's actual
 * scene output (see hud-status.ts).
 *
 * The deadband test also carries the no-bypass repro of the 2026-07-18 field
 * report ("spawned spheres showed no overlay; after looking away and back they
 * suddenly had one, and not at the configured show/hide point"). The revised
 * rule (framework wayfinding-placement, 2026-07-18): visibility is a pure
 * DISTANCE state machine, independent of view direction. A fresh spawn beyond
 * distanceMin shows its indicator immediately (even inside the deadband); a
 * deactivated target shows NOTHING — no ring and no arrow — until distanceMax,
 * so a glance away can no longer activate it (the original prototype parity
 * let hidden → off-screen-arrow → ring bypass the activation threshold; unit
 * repro pinned in wayfinding-placement.test.ts).
 */

test.describe("Wayfinding HUD demo — walk flow (real HUD)", () => {
  test("arriving hides the ring, walking away reactivates it beyond distanceMax @pr", async ({
    page,
  }) => {
    // The simulator walks on requestAnimationFrame, so the fake clock walks it
    // without waiting: 16 ms frames whatever the size of the step (see the
    // header of entrance.spec.js).
    await page.clock.install();
    await page.goto("/");
    await page.clock.runFor(1000);
    const status = page.getByTestId("hud-status");
    // Initial: ahead target ~19 m away with deadband 8/12 → visible ring.
    await expect(status).toContainText("rings 1");
    await expect(status).toContainText("hidden 0");

    // Walk forward until inside distanceMin (8 m): the ring must hide.
    // ~11 m at 4 m/s ≈ 3 s of holding "w", so 4 s of clock is past it.
    await page.keyboard.down("w");
    await page.clock.runFor(4000);
    await expect(status).toContainText("hidden 1");
    await page.keyboard.up("w");

    // Walk backward: the target must stay hidden through the deadband and
    // reactivate only once it is distanceMax (12 m) away again.
    await page.keyboard.down("s");
    await page.clock.runFor(4000);
    await expect(status).toContainText("hidden 0");
    await page.keyboard.up("s");
    await expect(status).toContainText("rings 1");
  });

  test("the deadband: a deactivated target survives a look-away, and the sliders re-create the HUD live @pr", async ({
    page,
  }) => {
    await page.goto("/");
    const status = page.getByTestId("hud-status");
    await expect(status).toContainText("targets 4");
    await expect(status).toContainText("rings 1");
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

    // Shrink the deadband to near zero: every target (all ≥ 12 m away) stays
    // active — unchanged split proves the HUD survived re-creation.
    await page.getByTestId("distance-min").fill("0.5");
    await page.getByTestId("distance-max").fill("1");
    await expect(page.getByTestId("distance-max-value")).toHaveText("1 m");
    await expect(status).toContainText("rings 1");
    await expect(status).toContainText("arrows 3");

    // Blow the deadband up beyond every target (min 20 m / max 30 m): the
    // fresh HUD applies the SPAWN rule (visibility is distance-gated
    // regardless of view direction), and every target sits below 20 m — the
    // whole scene goes dark, off-screen arrows included.
    await page.getByTestId("distance-min").fill("20");
    await page.getByTestId("distance-max").fill("30");
    await expect(status).toContainText("hidden 4", { timeout: 5000 });
    await expect(status).toContainText("rings 0");
    await expect(status).toContainText("arrows 0");
  });
});
