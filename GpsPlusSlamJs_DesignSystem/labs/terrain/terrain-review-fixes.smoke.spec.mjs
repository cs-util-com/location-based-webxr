// @ts-check
/**
 * The terrain lab's imagery-style fixes, in the browser: the imagery
 * styles say why they are dark at night; globe-bands draws style B until
 * the drawn region's ramp exists, never black or the previous region's
 * ramp; the imagery decode keeps the water's colour under the mask; and
 * the decode survives a lost WebGL context.
 *
 * Why this file matters: all four are page behaviour no unit test reaches.
 * A style that opens black at night, shows the Alps' colours over the Blue
 * Ridge while the new imagery loads, or draws lakes black, still draws a
 * plausible map, and a lost decode context only shows on the next place;
 * so only a pixel, a decode and a status-line check catch them.
 */
import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import {
  applyHash,
  boot,
  fixtureTile,
  gridAround,
  readPixels,
  routeAll,
  state,
  sweepLine,
} from "./terrain-smoke-helpers.mjs";
import { sampleImagery } from "./terrain-far-field.js";
import { sunLitColour } from "./terrain-sun.js";

const DAY = "2026-06-21T11:00:00Z";
const NIGHT = "2026-06-21T23:00:00Z";
const VIEW = `alt=300000&tilt=0&head=0&svf=0&tau=0&exag=1&light=1&time=${DAY}`;
/** The canvas points both styles are read at: the middle of the frame. */
const POINTS = gridAround([0.5, 0.5], 0.3, 9);

/** The largest channel difference between two pixel reads. */
const maxDiff = (a, b) =>
  Math.max(
    ...a.flatMap((p, i) => [0, 1, 2].map((c) => Math.abs(p[c] - b[i][c]))),
  );

test("globe-bands draws style B when the imagery cannot load", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await routeAll(page, fixtureTile);
  await page.route("**/globe-assets/**", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await boot(page, `place=alps&${VIEW}&style=globe-bands`);
  await page.waitForFunction(
    () => window.__terrainLab.state().farState === "failed",
    null,
    { timeout: 90_000 },
  );
  const s = await state(page);
  expect(s.shaderStyle).toBe(5);
  expect(s.globeColour.bandsOn).toBe(false);
  const bands = await readPixels(page, POINTS);
  await applyHash(page, `place=alps&${VIEW}&style=natural`);
  const natural = await readPixels(page, POINTS);
  const diff = maxDiff(bands, natural);
  console.log(
    `globe-bands without imagery against style B: max channel diff ${diff}`,
  );
  expect(diff).toBeLessThanOrEqual(1);
});

test("globe-bands never draws the previous region's ramp while the new imagery loads", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await routeAll(page, fixtureTile);
  // The imagery passes until `hold` is set; then it waits for `release`.
  let hold = false;
  /** @type {() => void} */
  let release = () => {};
  const held = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  await page.route("**/globe-assets/**", async (route) => {
    if (hold) await held;
    return route.continue();
  });
  await boot(page, `place=alps&${VIEW}&style=globe-bands`);
  await page.waitForFunction(
    () => window.__terrainLab.state().globeColour.bandsOn,
    null,
    { timeout: 120_000 },
  );
  hold = true;
  await applyHash(page, `place=appalachians&${VIEW}&style=globe-bands`);
  await page.waitForFunction(
    () => {
      const s = window.__terrainLab.state();
      return s.place === "appalachians" && s.hasData === true;
    },
    null,
    { timeout: 120_000 },
  );
  const s = await state(page);
  expect(s.farState).toBe("loading");
  expect(s.globeColour.bandsOn).toBe(false);
  const bands = await readPixels(page, POINTS);
  await applyHash(page, `place=appalachians&${VIEW}&style=natural`);
  const natural = await readPixels(page, POINTS);
  const diff = maxDiff(bands, natural);
  console.log(
    `globe-bands while the new imagery loads against style B: max channel diff ${diff}`,
  );
  expect(diff).toBeLessThanOrEqual(1);
  release();
});

test("an imagery style at night says the sun is down, and stops saying it by day", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await routeAll(page, fixtureTile);
  const errors = await boot(
    page,
    `place=alps&svf=0&style=globe-albedo&time=${NIGHT}`,
  );
  let s = await state(page);
  expect(s.sun.elevationDeg).toBeLessThan(0);
  expect(s.errorText).toContain("below the horizon");
  expect(s.errorText).toContain("2026-06-21 23:00 UTC");
  await expect(page.locator("#terrain-error")).toBeVisible();
  await applyHash(page, `place=alps&svf=0&style=globe-albedo&time=${DAY}`);
  s = await state(page);
  expect(s.sun.elevationDeg).toBeGreaterThan(0);
  expect(s.errorText).not.toContain("below the horizon");
  // The map lights never say it: they are not the sun.
  await applyHash(page, `place=alps&svf=0&style=natural&time=${NIGHT}`);
  s = await state(page);
  expect(s.light).toBe(0);
  expect(s.errorText).not.toContain("below the horizon");
  expect(errors).toEqual([]);
});

// Fixed 2026-10-01: the imagery tiles carry the globe's
// water mask in their alpha (0 on water, the colour under it kept). The
// page decoded them through a 2D canvas, which stores premultiplied colour,
// so every water pixel came back BLACK: globe-albedo (C1, the provisional
// default), the far field and style C drew lakes black where the globe
// draws their colour. The globe hands the tiles to the GPU with
// `premultiplyAlpha: "none"`; the lab now reads them back the same way.
//
// The ORACLE is independent of the browser: sharp (libvips' WebP decoder,
// the tool GpsPlusSlamJs_Globe's own tests decode these tiles with) reads
// the same file without premultiplying. Blue Marble's lakes are dark and
// not blue: Lake Constance is about (2, 13, 0) of 255, so the test holds
// the lab to the oracle rather than to a guessed colour.

/** The Alps' level-5 tile (it holds Lake Constance), on disk and served. */
const TILE = { z: 5, x: 33, y: 7 };
const TILE_URL = `/globe-assets/blue-marble-4326/${TILE.z}/${TILE.x}/${TILE.y}.webp`;
const TILE_FILE = fileURLToPath(
  new URL(
    `../../../GpsPlusSlamJs_Globe/assets/blue-marble-4326/${TILE.z}/${TILE.x}/${TILE.y}.webp`,
    import.meta.url,
  ),
);
/** Lake Constance's Obersee: the 9 x 9 pixels around it hold open water. */
const LAKE = { lat: 47.56, lng: 9.42 };
const DEG_PER_PX = 180 / 2 ** TILE.z / 256;

/**
 * The most a channel of the lab's decode may differ from the oracle's at
 * the lake (8-bit): two WebP decoders (Chrome's and libvips') may round
 * the lossy colour planes differently. Swept 0-4 and logged.
 */
const DECODE_TOLERANCE = 2;
/**
 * The most a channel of C1's drawn lake pixel may differ from the
 * oracle's colour lit by the sun term (8-bit): the 1 km albedo grid over
 * the bilinear imagery, the GPU's 8-bit filtering and the tone curve, as
 * C1's own reference smoke tolerates (mean 4). Swept 1-6 and logged.
 */
const DRAWN_TOLERANCE = 4;

test("the imagery keeps the water's colour under the mask, held to an independent decode, and C1 draws it", async ({
  page,
}) => {
  test.setTimeout(240_000);
  // The oracle: the tile file decoded by sharp, never premultiplied.
  const oracle = await sharp(TILE_FILE)
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(oracle.info.channels).toBe(4);
  expect(oracle.info.premultiplied).toBe(false);
  const px0 = Math.floor((LAKE.lng + 180) / DEG_PER_PX) - TILE.x * 256;
  const py0 = Math.floor((90 - LAKE.lat) / DEG_PER_PX) - TILE.y * 256;
  /** The lake: every water pixel (oracle alpha 0) of the 9 x 9 window. */
  const lake = [];
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const i = 4 * ((py0 + dy) * 256 + px0 + dx);
      if (oracle.data[i + 3] === 0) {
        lake.push({ i, rgb: [...oracle.data.subarray(i, i + 3)] });
      }
    }
  }
  expect(lake.length).toBeGreaterThan(30);

  await routeAll(page, fixtureTile);
  const errors = await boot(
    page,
    `place=alps&${VIEW}&style=globe-albedo&detail=0`,
  );
  await page.waitForFunction(
    () => {
      const s = window.__terrainLab.state();
      return s.farState === "ready" && s.globeColour.albedo;
    },
    null,
    { timeout: 120_000 },
  );
  // The lab's decode and a 2D-canvas decode of the same served file.
  const decoded = await page.evaluate(async (url) => {
    const blob = await (await fetch(url)).blob();
    const lab = await window.__terrainLab.decodeRgba(blob);
    const bitmap = await createImageBitmap(blob, {
      colorSpaceConversion: "none",
      premultiplyAlpha: "none",
    });
    const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = surface.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    return {
      lab: [...lab.data],
      canvas: [...context.getImageData(0, 0, bitmap.width, bitmap.height).data],
    };
  }, TILE_URL);
  const worst = Math.max(
    ...lake.flatMap(({ i, rgb }) =>
      rgb.map((v, c) => Math.abs(decoded.lab[i + c] - v)),
    ),
  );
  const canvasSum = lake.reduce(
    (s, { i }) =>
      s + decoded.canvas[i] + decoded.canvas[i + 1] + decoded.canvas[i + 2],
    0,
  );
  const oracleMean = [0, 1, 2].map(
    (c) => lake.reduce((s, p) => s + p.rgb[c], 0) / lake.length,
  );
  // The 2D-canvas decode is the old path. Whether it reads the lake black
  // is the BROWSER's choice (a canvas that stores premultiplied colour, as
  // Chromium's does, keeps nothing under alpha 0), so it is logged as the
  // precondition that made the old path wrong, not asserted.
  console.log(
    `Lake Constance, ${lake.length} water pixels: oracle mean ${oracleMean.map((v) => v.toFixed(1)).join(", ")}; ` +
      `lab decode worst channel difference ${worst} ` +
      `(${sweepLine(worst, [0, 1, 2, 3, 4])}); canvas decode RGB sum ${canvasSum} ` +
      `(${canvasSum === 0 ? "black: this browser's canvas premultiplies" : "this browser's canvas keeps the colour"})`,
  );
  // The lab reads what the file holds under the mask.
  expect(worst).toBeLessThanOrEqual(DECODE_TOLERANCE);
  // Non-vacuous: the lake's colour is not black in the file.
  expect(Math.max(...oracleMean)).toBeGreaterThan(5);
  // Land pixels: the lab's decode is the canvas's, byte for byte (same
  // bytes, same row order), so the change touches the water only.
  let landDiffers = 0;
  for (let i = 0; i < oracle.data.length; i += 4) {
    if (oracle.data[i + 3] !== 255) continue;
    if (
      [0, 1, 2, 3].some((c) => decoded.lab[i + c] !== decoded.canvas[i + c])
    ) {
      landDiffers += 1;
    }
  }
  expect(landDiffers).toBe(0);

  // C1's drawn pixel at the middle of the lake against the oracle's
  // imagery there, lit flat by the sun term (detail 0: C1 IS the lit
  // imagery). The canvas decode would have drawn it black.
  const centre = lake[Math.floor(lake.length / 2)];
  const cpx = (centre.i / 4) % 256;
  const cpy = Math.floor(centre.i / 4 / 256);
  const at = {
    lat: 90 - (TILE.y * 256 + cpy + 0.5) * DEG_PER_PX,
    lng: -180 + (TILE.x * 256 + cpx + 0.5) * DEG_PER_PX,
  };
  const albedo = sampleImagery(
    [{ ...TILE, width: 256, height: 256, data: oracle.data }],
    at.lat,
    at.lng,
  );
  const s = await state(page);
  const want = sunLitColour(albedo, Math.max(0, s.sun.enu[2]), s.sunIntensity);
  const ground = await page.evaluate(({ lat, lng }) => {
    const e = window.__terrainLab.toEnu(lat, lng);
    return { e, field: window.__terrainLab.fieldAt(e.x, e.y) };
  }, at);
  const [drawn] = await readPixels(
    page,
    await page.evaluate(
      (p) => window.__terrainLab.projectAll([p]),
      [ground.e.x, ground.field.heightM - s.datum, -ground.e.y],
    ),
  );
  const drawnDiff = Math.max(
    ...want.map((v, c) => Math.abs(Math.round(v * 255) - drawn[c])),
  );
  console.log(
    `C1 at the lake: drawn ${drawn.slice(0, 3).join(", ")}, expected ` +
      `${want.map((v) => Math.round(v * 255)).join(", ")} ` +
      `(worst channel ${drawnDiff}: ${sweepLine(drawnDiff, [1, 2, 3, 4, 6])})`,
  );
  expect(drawnDiff).toBeLessThanOrEqual(DRAWN_TOLERANCE);
  // Clearly brighter than the canvas decode's black (sun-lit black is 0).
  expect(Math.max(drawn[0], drawn[1], drawn[2])).toBeGreaterThan(
    DRAWN_TOLERANCE,
  );
  expect(errors).toEqual([]);
});

// The decode reads the tiles back through a WebGL2 context it keeps. A GPU
// reset, or the browser reclaiming contexts when a page holds many, LOSES
// that context; every later decode through it then reads nothing, and the
// next place's imagery fails to load. The decode makes a new context when
// its own is lost.
test("the imagery decode survives a lost WebGL context", async ({ page }) => {
  test.setTimeout(180_000);
  await routeAll(page, fixtureTile);
  const errors = await boot(
    page,
    `place=alps&${VIEW}&style=globe-albedo&detail=0`,
  );
  await page.waitForFunction(
    () => window.__terrainLab.state().farState === "ready",
    null,
    { timeout: 120_000 },
  );
  const result = await page.evaluate(async (url) => {
    const blob = await (await fetch(url)).blob();
    const before = await window.__terrainLab.decodeRgba(blob);
    const lost = window.__terrainLab.loseImageryContext();
    let after = null;
    let error = null;
    try {
      after = await window.__terrainLab.decodeRgba(blob);
    } catch (e) {
      error = String(e?.message ?? e);
    }
    const differs = after
      ? before.data.some((v, i) => v !== after.data[i])
      : null;
    return { lost, error, differs, length: after?.data.length ?? 0 };
  }, TILE_URL);
  console.log(
    `imagery decode after a lost context: lost ${result.lost}, ` +
      `error ${result.error}, bytes ${result.length}, differs ${result.differs}`,
  );
  // Non-vacuous: the context really was lost.
  expect(result.lost).toBe(true);
  expect(result.error).toBeNull();
  expect(result.length).toBe(256 * 256 * 4);
  expect(result.differs).toBe(false);
  expect(errors).toEqual([]);
});
