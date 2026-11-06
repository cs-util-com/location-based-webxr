import { test, expect } from "./e2e-test.js";
import { countAccentPixels } from "./count-accent-pixels.js";

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
 *
 * It is also the pixel-level proof that the indicators are DRAWN. Every other
 * spec asserts through the DOM status line, which is derived from
 * `camera.children` — the presenter's scene-graph state. That seam cannot
 * detect a wiring bug where the indicators exist in the graph but are never
 * drawn. Exactly that shipped (field report 2026-07-20): three.js only renders
 * objects reachable from the scene root, the framework HUD parents every
 * indicator to the camera, and the simulator never added its camera to the
 * scene — so the status line reported rings/arrows while the canvas showed
 * none.
 *
 * Discriminator: the procedural indicators wear the design system's accent
 * `#f2971f` (242, 151, 31 — orange: red high, green mid, blue low). Nothing
 * else in the simulator view is orange — background #222, grid greys,
 * waypoint markers green, labels white — so counting accent-dominant pixels
 * in the screen centre (where the ahead target's ring sits at boot) uniquely
 * detects the rendered HUD (the band lives in count-accent-pixels.js, shared
 * with the image-indicator spec, which counts the diamond sprite's dot).
 */

test.describe("Wayfinding HUD demo — smoke & desktop entry", () => {
  test("loads the simulator with the real HUD, draws the ring the status line claims, on a clean console @pr", async ({
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

    // Dismiss the translucent mode screen so it cannot tint the screenshot
    // (any keydown dismisses it; Shift does not move the camera). Done after
    // the status line is live: the dismissal listener registers in the same
    // async mode-wiring step, so pressing earlier can race the module load.
    await page.keyboard.press("Shift");
    await expect(page.getByTestId("mode-screen")).toBeHidden();

    // Screenshot only the central region: the ahead target sits straight
    // down the boot view axis, so its ring renders around the screen centre —
    // and the HUD control panel / status overlays near the edges stay out.
    const canvas = page.locator("#app canvas");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const clip = {
      x: box.x + box.width * 0.25,
      y: box.y + box.height * 0.25,
      width: box.width * 0.5,
      height: box.height * 0.5,
    };
    // The ring annulus alone covers several hundred pixels at any desktop
    // viewport — measured 839 accent-dominant pixels on 2026-09-04 after the
    // ring thinned to a third of its width (the 2026-07 ring was ~3× that),
    // so 100 keeps an ~8× margin; a persistent ~0 means the indicator exists
    // in the graph but is not rendered (the camera-not-in-scene class of
    // bug). POLLED, not one-shot: the status line derives from the scene graph
    // and updates ahead of the first painted WebGL frame, so under
    // full-cascade CPU contention a single screenshot can race the paint and
    // read 0 (flaked twice on 2026-07-24). Polling keeps the spec's purpose —
    // a ring that never renders still fails after the timeout.
    await expect
      .poll(
        async () => {
          const screenshot = await page.screenshot({ clip });
          return countAccentPixels(page, screenshot);
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(100);

    expect(errors).toEqual([]);
  });
});
