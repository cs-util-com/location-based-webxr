// @ts-check
import { expect, test } from "@playwright/test";

/**
 * Why this test matters: the synthetic walk is the splat trainer's test
 * input, and only a real browser renders it: WebGL draws the scene, the
 * canvas encodes JPEGs, and the zip is written and read back in the page.
 * The unit tests pin the geometry, the depth and the zip with placeholder
 * photos; this proves the rendered walk, both straight and as a loop,
 * passes the splat trainer's reader whole, and that its photos are real
 * images of the scene (decodable, the size asked for, not one flat
 * colour). A software renderer is enough.
 *
 * What it cannot catch: whether a trainer converges on these photos (the
 * trainer's own checks), or how a phone's camera differs from a render.
 */

/** @param {import("@playwright/test").Page} page */
async function routeNetwork(page) {
  // Nothing leaves the machine: every other host is refused.
  await page.route(
    (url) => !["localhost", "127.0.0.1"].includes(url.hostname),
    (route) => route.abort(),
  );
}

for (const walk of ["straight", "loop"]) {
  test(`a rendered ${walk} walk passes the splat trainer's reader`, async ({
    page,
  }) => {
    await routeNetwork(page);
    await page.goto("/splat-scene-check.html");
    await page.locator("#walk").selectOption(walk);
    await page.locator("#frames").fill("6");
    await page.locator("#build").click();
    const state = page.locator("#state");
    await expect(state).toHaveAttribute("data-state", /read|refused|error/, {
      timeout: 60_000,
    });
    await expect(state).toHaveAttribute("data-state", "read");
    await expect(state).toContainText("Read: 6 frames of 320 x 240");
    await expect(state).toContainText("6 depth samples");
    await expect(page.locator("#build")).toBeEnabled();
    await expect(page.locator("#save")).toHaveAttribute(
      "download",
      `synthetic-${walk}-walk.zip`,
    );

    const photo = page.locator("#first-photo");
    await expect(photo).toBeVisible();
    const pixels = await photo.evaluate(async (img) => {
      const image = /** @type {HTMLImageElement} */ (img);
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (ctx === null) throw new Error("no 2D context");
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const greys = new Set();
      for (let i = 0; i < data.length; i += 4 * 97) {
        greys.add(Math.round((data[i] + data[i + 1] + data[i + 2]) / 24));
      }
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
        levels: greys.size,
      };
    });
    expect(pixels.width).toBe(320);
    expect(pixels.height).toBe(240);
    // A textured scene shows many brightness levels; a blank or failed
    // render shows one or two.
    expect(pixels.levels).toBeGreaterThan(10);
  });
}
