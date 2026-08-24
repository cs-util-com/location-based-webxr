import { test, expect } from "./e2e-test.js";

/**
 * Image-indicator toggle e2e — switches the REAL HUD between the procedural
 * cone/ring meshes and the self-made image sprites.
 *
 * Why this suite matters: this is the repo's only automated exercise of the
 * framework's `arrowSprite`/`circleSprite` URL path on a real render path —
 * a real TextureLoader fetch of the bundled PNGs in a real Chromium (the
 * graduation summary's "sprite URL path untested" gap). The status line
 * derives the style from the presenter's actual scene objects (Sprite vs
 * Mesh — see hud-status.ts), so the assertions prove the toggle reached the
 * scene, not just the config.
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

    // Enable: the sprite PNGs must actually be fetched (TextureLoader URL
    // path) and the presenter must now hold sprite indicators.
    const arrowFetched = page.waitForResponse(
      (response) =>
        response.url().includes("wayfinding-arrow") && response.ok(),
    );
    await page.getByTestId("image-indicators").check();
    await arrowFetched;
    await expect(status).toContainText("image indicators");
    // The HUD survived re-creation: full target split still reported.
    await expect(status).toContainText("targets 4");
    await expect(status).toContainText("hidden 0");

    // Disable: back to the procedural cone/ring.
    await page.getByTestId("image-indicators").uncheck();
    await expect(status).toContainText("procedural indicators");

    // A failed texture load surfaces as a console error — none allowed.
    expect(errors).toEqual([]);
  });
});
