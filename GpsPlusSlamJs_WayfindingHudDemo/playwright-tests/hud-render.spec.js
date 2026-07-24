import { test, expect } from "@playwright/test";

/**
 * Pixel-level render proof for the desktop simulator's HUD indicators.
 *
 * Why this suite matters: every other spec asserts through the DOM status
 * line, which is derived from `camera.children` — the presenter's
 * scene-graph state. That seam cannot detect a wiring bug where the
 * indicators exist in the graph but are never DRAWN. Exactly that shipped
 * (field report 2026-07-20): three.js only renders objects reachable from
 * the scene root, the framework HUD parents every indicator to the camera,
 * and the simulator never added its camera to the scene — so the status
 * line reported rings/arrows while the canvas showed none. This spec closes
 * the gap by asserting actual rendered pixels.
 *
 * Discriminator: the procedural indicators use the HUD tint 0xff3b30
 * (strong red, green/blue ≈ 50). Nothing else in the simulator view is
 * red-dominant — background #222, grid greys, waypoint markers green — so
 * counting red-dominant pixels in the screen centre (where the ahead
 * target's ring sits at boot) uniquely detects the rendered HUD.
 */

/**
 * Count red-dominant (HUD tint) pixels in a PNG buffer by decoding it in
 * the page — keeps the check dependency-free (no node PNG library).
 */
async function countHudTintPixels(page, pngBuffer) {
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 150 && g < 120 && b < 120) count += 1;
    }
    return count;
  }, pngBuffer.toString("base64"));
}

test.describe("Wayfinding HUD demo — rendered pixels", () => {
  test("the ahead target's ring is actually drawn, not just reported by the status line", async ({
    page,
  }) => {
    await page.goto("/");

    // Wait for the real HUD to report the expected boot state first — the
    // status line must CLAIM a ring so a blank canvas is provably a render
    // bug, not a placement/state-machine issue.
    const status = page.getByTestId("hud-status");
    await expect(status).toContainText("rings 1");

    // Dismiss the translucent mode screen so it cannot tint the screenshot
    // (any keydown dismisses it; Shift does not move the camera).
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
    // viewport; a persistent ~0 means the indicator exists in the graph but
    // is not rendered (the camera-not-in-scene class of bug). POLLED, not
    // one-shot: the status line derives from the scene graph and updates
    // ahead of the first painted WebGL frame, so under full-cascade CPU
    // contention a single screenshot can race the paint and read 0 (flaked
    // twice on 2026-07-24). Polling keeps the spec's purpose — a ring that
    // never renders still fails after the timeout.
    await expect
      .poll(
        async () => {
          const screenshot = await page.screenshot({ clip });
          return countHudTintPixels(page, screenshot);
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(100);
  });
});
