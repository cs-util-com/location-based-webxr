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
 */

test.describe("Wayfinding HUD demo — walk flow (real HUD)", () => {
  test("arriving hides the ring, walking away reactivates it beyond distanceMax", async ({
    page,
  }) => {
    await page.goto("/");
    const status = page.getByTestId("hud-status");
    // Initial: ahead target ~19 m away with deadband 8/12 → visible ring.
    await expect(status).toContainText("rings 1");
    await expect(status).toContainText("hidden 0");

    // Walk forward until inside distanceMin (8 m): the ring must hide.
    // ~11 m at 4 m/s ≈ 3 s of holding "w".
    await page.keyboard.down("w");
    await expect(status).toContainText("hidden 1", { timeout: 15000 });
    await page.keyboard.up("w");

    // Walk backward: the target must stay hidden through the deadband and
    // reactivate only once it is distanceMax (12 m) away again.
    await page.keyboard.down("s");
    await expect(status).toContainText("hidden 0", { timeout: 15000 });
    await page.keyboard.up("s");
    await expect(status).toContainText("rings 1");
  });

  test("slider changes re-create the HUD with the new deadband live", async ({
    page,
  }) => {
    await page.goto("/");
    const status = page.getByTestId("hud-status");
    await expect(status).toContainText("rings 1");

    // Shrink the deadband to near zero: every target (all ≥ 12 m away) stays
    // active — unchanged split proves the HUD survived re-creation.
    await page.getByTestId("distance-min").fill("0.5");
    await page.getByTestId("distance-max").fill("1");
    await expect(page.getByTestId("distance-max-value")).toHaveText("1 m");
    await expect(status).toContainText("rings 1");
    await expect(status).toContainText("arrows 3");

    // Blow the deadband up beyond every target (min 20 m / max 30 m): the
    // fresh HUD applies the SPAWN rule (2026-07-18 revision — visibility is
    // distance-gated regardless of view direction), and every target sits
    // below 20 m — the whole scene goes dark, off-screen arrows included.
    await page.getByTestId("distance-min").fill("20");
    await page.getByTestId("distance-max").fill("30");
    await expect(status).toContainText("hidden 4", { timeout: 5000 });
    await expect(status).toContainText("rings 0");
    await expect(status).toContainText("arrows 0");
  });
});
