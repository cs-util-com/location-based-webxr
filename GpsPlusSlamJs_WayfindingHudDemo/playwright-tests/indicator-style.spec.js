import { test, expect } from "./e2e-test.js";
import { countAccentPixels } from "./count-accent-pixels.js";

/**
 * Image-indicator toggle e2e — switches the REAL HUD between the procedural
 * cone/ring meshes and the self-made image sprites.
 *
 * Why this suite matters: this is the repo's only automated exercise of the
 * framework's `arrowSprite`/`circleSprite` URL path on a real render path —
 * a real TextureLoader fetch of the bundled SVGs in a real Chromium (the
 * graduation summary's "sprite URL path untested" gap). The status line
 * derives the style from the presenter's actual scene objects (Sprite vs
 * Mesh — see hud-status.ts), so the assertions prove the toggle reached the
 * scene, not just the config — and, since 2026-09-04, that the sprite
 * actually PAINTS: an SVG the loader accepted but rasterised empty (no
 * intrinsic size, a broken filter) would still report "image indicators"
 * while the canvas showed nothing, so the diamond's accent dot is counted in
 * pixels at the screen centre, where the ahead target's sprite sits at boot.
 */

test.describe("Wayfinding HUD demo — image-indicator toggle", () => {
  test("toggling switches the live HUD between procedural and image indicators", async ({
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
    const status = page.getByTestId("hud-status");
    await expect(status).toContainText("procedural indicators");

    // Dismiss the mode screen via keyboard BEFORE clicking the checkbox:
    // the first pointerdown dismisses it, which reflows the overlay and
    // moves the HUD panel mid-click (the click would then miss the box).
    await page.keyboard.press("q"); // any key; not a movement key
    await expect(page.getByTestId("mode-screen")).toBeHidden();

    // Enable: the presenter must now hold sprite indicators. (The spec used
    // to await the arrow PNG's network response as proof of the loader path;
    // the SVGs are small enough for a production build to inline as data URIs
    // and produce no response at all, so the painted pixels below are the
    // proof now — a stronger one, since it fails for a texture that loaded
    // but rasterised empty.)
    await page.getByTestId("image-indicators").check();
    await expect(status).toContainText("image indicators");
    // The HUD survived re-creation: full target split still reported.
    await expect(status).toContainText("targets 4");
    await expect(status).toContainText("hidden 0");

    // And the diamond sprite actually paints: its accent centre dot covers
    // a few hundred pixels at the screen centre at the desktop viewport
    // (measured 528 on 2026-09-04, so 50 keeps a ~10× margin). POLLED,
    // because the texture upload follows the fetch by a frame or two, and
    // the status line reports the sprite before it is painted.
    const canvas = page.locator("#app canvas");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const clip = {
      x: box.x + box.width * 0.25,
      y: box.y + box.height * 0.25,
      width: box.width * 0.5,
      height: box.height * 0.5,
    };
    await expect
      .poll(
        async () => countAccentPixels(page, await page.screenshot({ clip })),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(50);

    // Disable: back to the procedural cone/ring.
    await page.getByTestId("image-indicators").uncheck();
    await expect(status).toContainText("procedural indicators");

    // A failed texture load surfaces as a console error — none allowed.
    expect(errors).toEqual([]);
  });
});
