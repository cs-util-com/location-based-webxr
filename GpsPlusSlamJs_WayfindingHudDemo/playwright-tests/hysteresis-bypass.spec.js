import { test, expect } from "@playwright/test";

/**
 * Repro e2e for the 2026-07-18 field report ("spawned spheres showed no
 * overlay; after looking away and back they suddenly had one, and not at
 * the configured show/hide point").
 *
 * Mechanism (pinned as a unit repro in the framework's
 * wayfinding-placement.test.ts): the distance hysteresis is PATH-DEPENDENT.
 * An on-screen target inside the deadband stays hidden no matter how long
 * you look at it — but looking AWAY promotes it to an edge arrow
 * (off-screen always shows one, regardless of distance), and looking back
 * converts that arrow to a ring at only distanceMin. The activation
 * threshold (distanceMax) is therefore bypassed by a glance away.
 *
 * This spec drives the REAL HUD through that exact loop in the desktop
 * simulator via OrbitControls camera drags. It asserts the CURRENT
 * (prototype-parity) behavior as executable documentation of the report —
 * invert the final assertions if the design decision changes the rule.
 */

test.describe("Wayfinding HUD demo — hysteresis bypass via look-away (field repro)", () => {
  test("a never-activated deadband target becomes visible after looking away and back", async ({
    page,
  }) => {
    await page.goto("/");
    const status = page.getByTestId("hud-status");
    await expect(status).toContainText("targets 4");
    // Dismiss the mode screen so drags hit the canvas, not the panel.
    await page.keyboard.press("s");
    await expect(page.getByTestId("mode-screen")).toBeHidden();

    // Widen the deadband so the ahead target (~19 m) sits INSIDE it:
    // hide below 15 m, show beyond 25 m. The fresh HUD starts it 'hidden'
    // although it is dead ahead — while the three off-screen targets keep
    // their arrows (distance-independent by design).
    await page.getByTestId("distance-max").fill("25");
    await page.getByTestId("distance-min").fill("15");
    await expect(status).toContainText("arrows 3");
    await expect(status).toContainText("rings 0");
    await expect(status).toContainText("hidden 1");

    // "Look away": drag the camera ~180° (OrbitControls: Δθ = 2π·dx/height;
    // viewport height 720 → 360 px ≈ 180°). The hidden ahead target goes
    // off-screen and immediately gains an edge arrow — nothing is 'hidden'
    // any more. (The exact arrow/ring split while turned around depends on
    // which rear targets are in view — the behind/elevated ones can even
    // show the same bypass ring there — so only the hidden count is
    // asserted for this intermediate pose.)
    await page.mouse.move(640, 150);
    await page.mouse.down();
    await page.mouse.move(280, 150, { steps: 20 });
    await page.mouse.up();
    await expect(status).toContainText("hidden 0");

    // "Look back": drag the same distance in reverse — the view returns to
    // the START pose, where before the glance the status was
    // 'rings 0 · hidden 1'. Now the SAME view shows the ahead target as a
    // RING at ~19 m (previousState 'arrow' converts at ≥ distanceMin 15 m)
    // although it never reached the 25 m activation distance. This
    // same-view before/after flip is the field-reported surprise.
    await page.mouse.move(640, 150);
    await page.mouse.down();
    await page.mouse.move(1000, 150, { steps: 20 });
    await page.mouse.up();
    await expect(status).toContainText("rings 1");
    await expect(status).toContainText("arrows 3");
    await expect(status).toContainText("hidden 0");
  });
});
