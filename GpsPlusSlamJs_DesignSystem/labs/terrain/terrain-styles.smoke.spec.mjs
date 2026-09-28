// @ts-check
/**
 * The terrain lab's styles B-E in the browser (terrain plan 2026-09-27-0605
 * §5 T2, §9 findings 7, 11 and 12).
 *
 * Why this file matters: each style's reference is unit-tested, but only
 * the GPU shows that the shader's branch is that reference: a swapped
 * uniform, a branch that never runs, or a far field read half a grid off
 * all draw a plausible map. So each style is held to the one property that
 * makes it that style, on real or synthetic terrain, and every check is
 * swept over its tolerance and shown to be able to fail (style A, or the
 * property's own knob at zero, fails it).
 */
import { expect, test } from "@playwright/test";

import { terrariumPng } from "../../../scripts/e2e/terrarium-png.mjs";
import { farColour } from "./terrain-far-field.js";
import {
  applyHash,
  boot,
  fixtureTile,
  gridAround,
  luminance,
  readPixels,
  routeAll,
  state,
  sweepLine,
} from "./terrain-smoke-helpers.mjs";
import { naturalWeights, saturation } from "./terrain-styles.js";

/** Normalised canvas points of ENU ground points, lifted by E above the datum. */
const project = (page, points) =>
  page.evaluate((ps) => window.__terrainLab.projectAll(ps), points);

/** Waits until the far field's imagery has loaded (or failed). */
const farSettled = (page) =>
  page.waitForFunction(
    () => ["ready", "failed"].includes(window.__terrainLab.state().farState),
    null,
    { timeout: 60_000 },
  );

/** Mean absolute channel difference between two pixel lists (8-bit). */
const meanDiff = (a, b) =>
  a.reduce(
    (sum, p, i) =>
      sum + [0, 1, 2].reduce((s, c) => s + Math.abs(p[c] - b[i][c]), 0),
    0,
  ) /
  (3 * a.length);

/**
 * The least mean change (8-bit) a style must make at fixed pixels against
 * style A. Every style is a different colour scheme, so the change is tens
 * of levels; a style whose branch never ran changes nothing. Swept 2-12.
 */
const STYLE_MIN_CHANGE = 6;

test("every style changes the Blue Ridge's pixels against style A", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await routeAll(page, fixtureTile);
  const errors = await boot(page, "preset=top&svf=0&tau=0");
  const points = gridAround([0.5, 0.5], 0.2, 7);
  const pastel = await readPixels(page, points);
  for (const style of ["natural", "globe", "swiss", "clay"]) {
    await applyHash(page, `preset=top&svf=0&tau=0&style=${style}`);
    if (style === "globe") await farSettled(page);
    const s = await state(page);
    expect(s.style).toBe(style);
    const px = await readPixels(page, points);
    const change = meanDiff(px, pastel);
    console.log(
      `style ${style}: mean change against A ${change.toFixed(1)} levels ` +
        `(needs more than: ${[2, 4, 6, 8, 12].map((t) => `${t}:${change > t ? "pass" : "fail"}`).join(" ")})` +
        (style === "globe"
          ? `, near weight ${s.farWeights.near.toFixed(3)}`
          : ""),
    );
    expect(change).toBeGreaterThan(STYLE_MIN_CHANGE);
  }
  expect(errors).toEqual([]);
});

/**
 * Style B's snow check (plan §9 finding 7): the margin either side of the
 * line the check trusts. The line S is the aspect-adjusted one at each
 * point (the rule: poleward faces hold snow lower), from the tested
 * reference; the edge noise (clamped to +-150 m) and the softening (+-150 m)
 * leave 100 m of slack at 400 m for the pixel sampling (half a 350 m pixel
 * on a slope under 0.3). Swept 300-500 m.
 */
const SNOW_MARGIN_M = 400;
const SNOW_MARGINS = [300, 400, 500];
/** The mask reads as snow at 90 % and as none at 2 % (8-bit 230 and 5). */
const SNOW_ON = 230;
const SNOW_OFF = 5;
/**
 * At E = 5 a ridge lifted five times can stand in front of a valley point
 * seen at a slant (measured 2026-09-28: 8 of 8792 bare points read as snow
 * over the whole region at E = 5, none at E = 1 or 2). So E = 1 and 2 are
 * checked over the whole region, and E = 5 within this distance of the
 * point straight below the camera, where the rays are within 11° of
 * vertical; the whole region's E = 5 counts are reported.
 */
const NADIR_M = 60_000;

test("style B: snow above its line on the Alps and none below, whatever E", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const record = await routeAll(page, fixtureTile);
  // Straight down from 300 km: the region fills the canvas's height, about
  // 350 m a pixel on the smoke's 800 px canvas.
  const camera = "alt=300000&tilt=0&head=0&svf=0&tau=0";
  const view = `place=alps&style=natural&snowMask=1&${camera}`;
  const errors = await boot(page, `${view}&exag=1`);
  expect(record.missing).toEqual([]);
  const s0 = await state(page);
  expect(s0.place).toBe("alps");
  const snowM = s0.lines.snowM;
  // The fitted line at 46.56° N (research §3: 3000 m at 46°, 125 m a degree).
  expect(snowM).toBeCloseTo(3000 - 125 * 0.56, 0);
  // A grid of ground points over the drawn region, with the field's own
  // heights and slopes (what the shader reads), and each point's line.
  const ground = (
    await page.evaluate(() => {
      const out = [];
      for (let i = 0; i < 120; i++) {
        for (let j = 0; j < 120; j++) {
          const x = -120_000 + (240_000 * i) / 119;
          const y = -120_000 + (240_000 * j) / 119;
          const f = window.__terrainLab.fieldAt(x, y);
          if (f) out.push({ x, y, ...f });
        }
      }
      return out;
    })
  ).map((p) => ({
    ...p,
    lineM: naturalWeights({ ...p, latDeg: 46.56 }).localSnowM,
  }));
  const gentle = (p) => Math.hypot(p.gx, p.gy) < 0.3;
  const nearNadir = (p) => Math.hypot(p.x, p.y) < NADIR_M;
  const results = [];
  for (const e of [1, 2, 5]) {
    await applyHash(page, `${view}&exag=${e}`);
    const at = await project(
      page,
      ground.map((p) => [p.x, e * (p.heightM - s0.datum), -p.y]),
    );
    const mask = (await readPixels(page, at)).map((px) => px[0]);
    for (const margin of SNOW_MARGINS) {
      for (const [area, inArea] of [
        ["region", () => true],
        ["near", nearNadir],
      ]) {
        const pick = (test) =>
          ground.flatMap((p, i) =>
            gentle(p) && inArea(p) && test(p) ? [mask[i]] : [],
          );
        const above = pick((p) => p.heightM > p.lineM + margin);
        const below = pick((p) => p.heightM < p.lineM - margin);
        const r = {
          e,
          margin,
          area,
          above: above.length,
          aboveOk: above.filter((m) => m >= SNOW_ON).length,
          below: below.length,
          belowOk: below.filter((m) => m <= SNOW_OFF).length,
        };
        results.push(r);
        console.log(
          `snow E=${e} ${area} margin ${margin} m: ${r.aboveOk} of ${r.above} points above are snow, ` +
            `${r.belowOk} of ${r.below} below are bare`,
        );
      }
    }
  }
  const find = (e, area) =>
    results.find(
      (q) => q.e === e && q.area === area && q.margin === SNOW_MARGIN_M,
    );
  // The line in metres does not move with E (plan §9 finding 7): the whole
  // region at E = 1 and 2, the middle at E = 5.
  for (const r of [find(1, "region"), find(2, "region"), find(5, "near")]) {
    // Non-vacuous: real snowfields and real valleys in the sample (the
    // middle has one gentle snowfield point at this grid, 40 in the region).
    expect(r.above, `E=${r.e} ${r.area}`).toBeGreaterThan(
      r.area === "region" ? 20 : 0,
    );
    expect(r.below, `E=${r.e} ${r.area}`).toBeGreaterThan(100);
    expect(r.aboveOk, `E=${r.e} ${r.area}`).toBe(r.above);
    expect(r.belowOk, `E=${r.e} ${r.area}`).toBe(r.below);
  }
  // The colours draw snow too: the snowfields are brighter than the forest
  // below the tree line (a lit meadow can match a shaded snowfield, so the
  // means are compared, by a clear step).
  await applyHash(page, `place=alps&style=natural&${camera}&exag=1`);
  const high = ground.filter(
    (p) => p.heightM > snowM + SNOW_MARGIN_M && gentle(p),
  );
  const low = ground.filter((p) => p.heightM < s0.lines.treeM - 300);
  const lum = async (list) =>
    (
      await readPixels(
        page,
        await project(
          page,
          list.map((p) => [p.x, p.heightM - s0.datum, -p.y]),
        ),
      )
    ).map(luminance);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const highLum = mean(await lum(high));
  const lowLum = mean(await lum(low));
  console.log(
    `snow colour: mean luminance on snow ${highLum.toFixed(1)}, below the tree line ${lowLum.toFixed(1)}`,
  );
  expect(highLum).toBeGreaterThan(lowLum + 20);
  // The taste values, swept and reported (owner rule 2026-09-13): the share
  // of the sampled ground above the snow line per offset, and the scene's
  // mean luminance per lift.
  const share = (offset) =>
    ground.filter((p) => p.heightM > snowM + offset).length / ground.length;
  console.log(
    `snow offset sweep: ${[-500, -250, 0, 250, 500]
      .map((o) => `${o} m: ${(100 * share(o)).toFixed(1)} %`)
      .join(", ")} of the ground above the line`,
  );
  const everywhere = await project(
    page,
    ground.map((p) => [p.x, p.heightM - s0.datum, -p.y]),
  );
  const lifts = [];
  for (const lift of [0, 0.1, 0.2, 0.3, 0.4]) {
    await applyHash(
      page,
      `place=alps&style=natural&${camera}&exag=1&lift=${lift}`,
    );
    const px = await readPixels(page, everywhere);
    lifts.push(`${lift}: ${mean(px.map(luminance)).toFixed(1)}`);
  }
  console.log(`lift sweep, mean luminance of the Alps: ${lifts.join(", ")}`);
  expect(errors).toEqual([]);
});

/** Metres east and north of the Blue Ridge centre for a z8 pixel centre. */
function pixelEnu(tx, ty, col, row) {
  const n = 256 * 256;
  const lng = ((tx * 256 + col + 0.5) / n) * 360 - 180;
  const my = Math.PI * (1 - (2 * (ty * 256 + row + 0.5)) / n);
  const lat = (Math.atan(Math.sinh(my)) * 180) / Math.PI;
  const lat0 = 37.9;
  return {
    x: (lng + 79.2) * 111_320 * Math.cos((lat0 * Math.PI) / 180),
    y: (lat - lat0) * 111_320,
  };
}

/** Serves z8 tiles of a height function of ENU metres (cached per tile). */
function syntheticTiles(heightAt) {
  const cache = new Map();
  return (key) => {
    if (!cache.has(key)) {
      const [, tx, ty] = key.split("/").map(Number);
      cache.set(
        key,
        terrariumPng(256, 256, (col, row) => {
          const { x, y } = pixelEnu(tx, ty, col, row);
          return heightAt(x, y);
        }),
      );
    }
    return { status: 200, body: cache.get(key) };
  };
}

/** (R - B) / (R + G + B): warmth independent of brightness. */
const warmth = ([r, g, b]) => (r - b) / Math.max(1, r + g + b);

/**
 * Style D's warm/cool margin: the least (R - B) / sum by which a lit slope
 * must be warmer than its shaded twin. Shading alone scales a colour and
 * leaves this ratio unchanged, so only the exposure palette can pass it.
 * Swept over the exposure (0 must fail) and reported.
 */
const WARMTH_MARGIN = 0.02;

test("style D: lit slopes warmer than shaded, and higher is lighter", async ({
  page,
}) => {
  test.setTimeout(300_000);
  // A ridge along north-east, 1500 m over a 300 m plain, 15 km wide: its
  // north-west face looks into the 315° light, its south-east face away.
  const SIGMA = 15_000;
  const across = (x, y) => (-x + y) / Math.SQRT2; // + toward the north-west
  await routeAll(
    page,
    syntheticTiles(
      (x, y) => 300 + 1500 * Math.exp(-0.5 * (across(x, y) / SIGMA) ** 2),
    ),
  );
  const view = "style=swiss&alt=300000&tilt=0&head=0&svf=0&tau=0&exag=1";
  const errors = await boot(page, view);
  const { datum } = await state(page);
  // Pairs at +-sigma across the ridge (its steepest), along its length.
  const pairs = [-40_000, -15_000, 10_000, 35_000].map((t) => {
    const along = [t / Math.SQRT2, t / Math.SQRT2];
    const nw = [-SIGMA / Math.SQRT2, SIGMA / Math.SQRT2];
    return [
      [along[0] + nw[0], along[1] + nw[1]],
      [along[0] - nw[0], along[1] - nw[1]],
    ];
  });
  const h = 300 + 1500 * Math.exp(-0.5) - datum;
  const points = pairs.flat().map(([x, y]) => [x, h, -y]);
  for (const exposure of [0, 0.1, 0.35, 0.7]) {
    await applyHash(page, `${view}&exposure=${exposure}`);
    const px = await readPixels(page, await project(page, points));
    const margins = pairs.map(
      (_, i) => warmth(px[2 * i]) - warmth(px[2 * i + 1]),
    );
    const least = Math.min(...margins);
    console.log(
      `swiss exposure ${exposure}: lit minus shaded warmth, least ${least.toFixed(4)} ` +
        `(margins ${[0.01, 0.02, 0.04].map((t) => `${t}:${least > t ? "pass" : "fail"}`).join(" ")})`,
    );
    if (exposure === 0) expect(least).toBeLessThan(WARMTH_MARGIN);
    if (exposure === 0.35) expect(least).toBeGreaterThan(WARMTH_MARGIN);
  }
  expect(errors).toEqual([]);
});

test("style D: flat terraces get lighter with height", async ({ page }) => {
  test.setTimeout(240_000);
  // Four flat terraces stepping up to the east, 40 km wide, with 10 km
  // ramps between: flat ground shows the ramp alone.
  const LEVELS = [200, 1200, 2200, 3200];
  const terrace = (x) => {
    const band = Math.min(3, Math.max(0, Math.floor((x + 100_000) / 50_000)));
    const into = x + 100_000 - band * 50_000;
    if (band === 0 || into > 10_000) return LEVELS[band];
    return (
      LEVELS[band - 1] + ((LEVELS[band] - LEVELS[band - 1]) * into) / 10_000
    );
  };
  await routeAll(
    page,
    syntheticTiles((x) => terrace(x)),
  );
  const errors = await boot(
    page,
    "style=swiss&alt=300000&tilt=0&head=0&svf=0&tau=0&exag=1",
  );
  const { datum } = await state(page);
  // The middle of each terrace's flat part.
  const xs = [-80_000, -15_000, 35_000, 85_000];
  const lum = (
    await readPixels(
      page,
      await project(
        page,
        xs.map((x) => [x, terrace(x) - datum, 0]),
      ),
    )
  ).map(luminance);
  console.log(
    `swiss terraces ${LEVELS.join("/")} m: luminance ${lum.map((l) => l.toFixed(1)).join(" < ")}`,
  );
  for (let i = 1; i < lum.length; i++)
    expect(lum[i]).toBeGreaterThan(lum[i - 1]);
  expect(errors).toEqual([]);
});

/**
 * Style E's saturation bound (plan §9 finding 7, "saturation about 0"):
 * the clay colour itself is 3.8 %, and no shade may add a hue. Style A's
 * greens, measured the same way, are far above it. Swept 0.04-0.12.
 */
const CLAY_MAX_SATURATION = 0.06;

test("style E: the relief without a hue", async ({ page }) => {
  test.setTimeout(240_000);
  await routeAll(page, fixtureTile);
  const errors = await boot(page, "preset=top&svf=8&tau=0");
  await page.waitForFunction(() => window.__terrainLab.state().svfDone, null, {
    timeout: 90_000,
  });
  const points = gridAround([0.5, 0.5], 0.25, 9);
  const most = async () =>
    Math.max(
      ...(await readPixels(page, points)).map((p) =>
        saturation(p.slice(0, 3).map((v) => v / 255)),
      ),
    );
  const pastel = await most();
  await applyHash(page, "preset=top&svf=8&tau=0&style=clay");
  const clay = await most();
  console.log(
    `saturation, most over 81 pixels: clay ${clay.toFixed(3)}, pastel ${pastel.toFixed(3)} ` +
      `(${sweepLine(clay, [0.04, 0.06, 0.08, 0.12])})`,
  );
  expect(clay).toBeLessThanOrEqual(CLAY_MAX_SATURATION);
  // Non-vacuous: style A would fail the same bound.
  expect(pastel).toBeGreaterThan(CLAY_MAX_SATURATION);
  expect(errors).toEqual([]);
});

/**
 * Style C's far-field tolerances (plan §9 finding 12), 8-bit per channel:
 * against the far-field grid the shader reads (the texel through the
 * globe's tone mapping) and against the imagery itself (one more bilinear
 * resampling, at 2 km against the imagery's 4.9 km). Swept and reported.
 */
const FAR_GRID_TOLERANCE = 3;
const FAR_IMAGERY_TOLERANCE = 12;

test("style C: from far away the terrain is the globe's own colour", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await routeAll(page, fixtureTile);
  // 2500 km up with the globe-only altitude at 1000 km: the near style's
  // weight and the far field's relief are both 0 there.
  const far = "farHigh=1000&farLow=100&alt=2500000&tilt=0&head=0&svf=0&tau=0";
  const errors = await boot(page, `style=globe&${far}`);
  await farSettled(page);
  const s = await state(page);
  expect(s.farState).toBe("ready");
  expect(s.farWeights).toEqual({ near: 0, relief: 0 });
  expect(s.credits).toContain("Blue Marble");
  const ground = await page.evaluate(() => {
    const out = [];
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 7; j++) {
        const x = -90_000 + 30_000 * i;
        const y = -90_000 + 30_000 * j;
        const f = window.__terrainLab.fieldAt(x, y);
        const { lat, lng } = window.__terrainLab.toLatLng(x, y);
        out.push({
          x,
          y,
          h: f.heightM,
          grid: window.__terrainLab.farAt(x, y),
          imagery: window.__terrainLab.imageryAt(lat, lng),
        });
      }
    }
    return out;
  });
  const at = await project(
    page,
    ground.map((p) => [p.x, 2 * (p.h - s.datum), -p.y]),
  );
  const px = await readPixels(page, at);
  const worst = (key) =>
    Math.max(
      ...ground.flatMap((p, i) =>
        farColour(p[key]).map((v, c) =>
          Math.abs(Math.round(v * 255) - px[i][c]),
        ),
      ),
    );
  const gridError = worst("grid");
  const imageryError = worst("imagery");
  console.log(
    `far field: worst channel error against the grid ${gridError} (${sweepLine(gridError, [1, 2, 3, 4, 6])}), ` +
      `against the imagery ${imageryError} (${sweepLine(imageryError, [4, 8, 12, 16])})`,
  );
  expect(gridError).toBeLessThanOrEqual(FAR_GRID_TOLERANCE);
  expect(imageryError).toBeLessThanOrEqual(FAR_IMAGERY_TOLERANCE);
  // Non-vacuous: style A at the same place and height is far from it.
  await applyHash(page, `style=pastel&${far}`);
  const pastel = await readPixels(page, at);
  const pastelError = Math.max(
    ...ground.flatMap((p, i) =>
      farColour(p.grid).map((v, c) =>
        Math.abs(Math.round(v * 255) - pastel[i][c]),
      ),
    ),
  );
  console.log(`far field: style A differs by up to ${pastelError}`);
  expect(pastelError).toBeGreaterThan(FAR_IMAGERY_TOLERANCE);
  expect(errors).toEqual([]);
});

test("style C: imagery that cannot load is said, and the near style stays", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await routeAll(page, fixtureTile);
  await page.route("**/globe-assets/**", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await boot(page, "style=globe&preset=top&svf=0");
  await farSettled(page);
  const s = await state(page);
  expect(s.farState).toBe("failed");
  expect(s.farWeights.near).toBe(1);
  expect(s.errorText).toContain("The Earth imagery could not load");
  await expect(page.locator("#terrain-error")).toBeVisible();
});

test("the plate lists the five styles and shows each style's own controls", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await routeAll(page, fixtureTile);
  await boot(page, "preset=top&svf=0");
  const options = await page
    .locator('select[data-hash-key="style"] option')
    .allTextContents();
  expect(options).toEqual([
    "A: Pastel atlas",
    "B: Natural colour",
    "C: Globe blend",
    "D: Swiss classic",
    "E: Clay",
  ]);
  const natural = page.locator('[data-section="terrain-natural"]');
  await expect(natural).toBeHidden();
  await page.locator('select[data-hash-key="style"]').selectOption("natural");
  await page.waitForFunction(() => /style=natural/.test(location.hash));
  await expect(natural).toBeVisible();
  await expect(page.locator("#terrain-lines")).toContainText("snow line");
  expect((await state(page)).shaderStyle).toBe(1);
});
