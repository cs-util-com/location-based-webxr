import { test, expect } from "./e2e-test.js";

/**
 * Tier 0 smoke for the wayfinding-HUD demo.
 *
 * Why this suite matters: unlike the sibling apps, this demo's desktop mode
 * needs no WebXR — the walk simulator runs the REAL framework HUD in a plain
 * Chromium. The smoke therefore proves the real integration boots: the
 * simulator auto-starts (canvas mounted), the mode screen offers exactly the
 * desktop path (no `navigator.xr` in Playwright Chromium), and the status
 * line reports the real HUD's initial indicator split for the synthetic
 * waypoint layout — one ring (the ahead target), arrows for the rest.
 */

test.describe("Wayfinding HUD demo — smoke & desktop entry", () => {
  test("loads the simulator with the real HUD and no console errors", async ({
    page,
  }) => {
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => {
      errors.push(String(error));
    });

    await page.goto("/");

    // Either-or entry: desktop shows the simulator hint, never Start AR.
    await expect(page.getByTestId("mode-screen")).toBeVisible();
    await expect(page.getByTestId("sim-note")).toBeVisible();
    await expect(page.getByTestId("start-ar-button")).toBeHidden();

    // The simulator auto-started: canvas mounted, HUD panel + status live.
    await expect(page.locator("#app canvas")).toBeAttached();
    await expect(page.getByTestId("hud-panel")).toBeVisible();
    const status = page.getByTestId("hud-status");
    await expect(status).toContainText("targets 4");
    // Real-HUD initial state for the synthetic layout: the ahead target is
    // on-screen beyond the activation distance (ring), the rest off-screen
    // (arrows), nothing hidden.
    await expect(status).toContainText("arrows 3");
    await expect(status).toContainText("rings 1");
    await expect(status).toContainText("hidden 0");

    // Sliders show the simulator-scale defaults.
    await expect(page.getByTestId("distance-min-value")).toHaveText("8 m");
    await expect(page.getByTestId("distance-max-value")).toHaveText("12 m");

    expect(errors).toEqual([]);
  });

  test("dismisses the mode screen on first interaction", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("mode-screen")).toBeVisible();
    // Wait until the simulator booted (status line live) — the dismissal
    // listener registers in the same async mode-wiring step, so pressing
    // earlier can race the module load.
    await expect(page.getByTestId("hud-status")).toContainText("targets");
    await page.keyboard.press("w");
    await expect(page.getByTestId("mode-screen")).toBeHidden();
  });
});
