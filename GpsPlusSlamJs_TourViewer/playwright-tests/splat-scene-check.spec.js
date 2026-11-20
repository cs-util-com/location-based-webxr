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
 * colour, each surface in its own colour where the depth says it is). A
 * software renderer is enough.
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

    // The photo and the depth must describe one scene: at each point of a
    // grid like the depth sampler's, the photo's colour must be the tint
    // of the surface the depth sample measures there (red over blue about
    // 0.45 on the object, 0.9 on a wall, 1.5 on the floor). A photo drawn
    // with another lens, pose or orientation than the depth fails this.
    const colours = await photo.evaluate(async (img, kind) => {
      const image = /** @type {HTMLImageElement} */ (img);
      const scene = await import("/src/checks/splat-scene/splat-scene.ts");
      const w = image.naturalWidth;
      const h = image.naturalHeight;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (ctx === null) throw new Error("no 2D context");
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, w, h).data;
      const pose = scene.sceneWalk(kind, 6)[0];
      const projection = scene.sceneProjection(w, h);
      /** @param {number} ratio */
      const nearestKind = (ratio) => {
        let best = "";
        let bestGap = Infinity;
        for (const [name, tint] of Object.entries(scene.SURFACE_TINT)) {
          const gap = Math.abs(Math.log(ratio / (tint[0] / tint[2])));
          if (gap < bestGap) {
            bestGap = gap;
            best = name;
          }
        }
        return best;
      };
      const grid = 12;
      let judged = 0;
      let agreed = 0;
      for (let row = 0; row < grid; row++) {
        for (let col = 0; col < grid; col++) {
          const sx = (col + 1) / (grid + 1);
          const sy = (row + 1) / (grid + 1);
          const hit = scene.sceneHitAt(pose, projection, sx, sy);
          if (hit === null) continue;
          let r = 0;
          let b = 0;
          const cx = Math.floor(sx * w);
          const cy = Math.floor(sy * h);
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const i = 4 * ((cy + dy) * w + (cx + dx));
              r += data[i];
              b += data[i + 2];
            }
          }
          // Too dark a spot of the texture says nothing about its tint.
          if (r + b < 25 * 2 * 40) continue;
          judged++;
          if (nearestKind(r / b) === hit.box.kind) agreed++;
        }
      }
      return { judged, agreed };
    }, walk);
    expect(colours.judged).toBeGreaterThan(60);
    // Edges of a box and dark texture blur a few points; most agree.
    expect(colours.agreed / colours.judged).toBeGreaterThan(0.85);
  });
}
