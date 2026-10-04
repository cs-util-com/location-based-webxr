// @ts-check
/**
 * The terrain lab's style `globe-classes` (C2) in the browser (globe
 * round-5 plan 2026-10-01-0945 §3.3).
 *
 * Why this file matters: `terrain-globe-classes.test.mjs` proves the class
 * arithmetic, but only the GPU shows that the shader reads the imagery's
 * land colour and water share where the page put them, weighs the classes
 * as the reference does and lights the result with the sun term. A kernel
 * in the wrong colour space, a swapped class or a water grid read as
 * colour all still draw a plausible map, so C2 is held to its reference at
 * real Alps pixels. The class-threshold sweep (the owner rule 2026-09-13)
 * runs here on the real relief and imagery, logged on two places.
 */
import { expect, test } from "@playwright/test";

import {
  applyHash,
  boot,
  fixtureTile,
  readPixels,
  routeAll,
  state,
  sweepLine,
} from "./terrain-smoke-helpers.mjs";
import {
  GLOBE_CLASSES,
  LAND_CLASSES,
  classAlbedo,
  landClassWeights,
} from "./terrain-globe-classes.js";
import { deltaE76 } from "./terrain-globe-colour.js";
import { reliefNormal, sunLight, sunLitColour } from "./terrain-sun.js";

const DAY = "2026-06-21T11:00:00Z";
const LOOK = { shade: 1.6, shadow: 0.8 };
const VIEW =
  `alt=300000&tilt=0&head=0&svf=0&tau=0&exag=1&light=1&time=${DAY}` +
  `&shade=${LOOK.shade}&shadow=${LOOK.shadow}`;

/** Waits until the place's imagery and C2's grids are in (or failed). */
const classesReady = (page, place) =>
  page.waitForFunction(
    (want) => {
      const s = window.__terrainLab.state();
      if (s.place !== want) return false;
      return s.farState === "failed" || s.globeColour.classes;
    },
    place,
    { timeout: 120_000 },
  );

/**
 * The worst-tolerated mean channel error (8-bit) of C2 against its
 * reference, as C1's and C3's (the GPU's 8-bit grid filtering and the
 * half-float field through the class lines and the tone curve). Swept 2-8.
 */
const CLASSES_MEAN_TOLERANCE = 4;

test("globe-classes: the imagery picks the classes, the relief places them, the sun lights them", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const record = await routeAll(page, fixtureTile);
  const errors = await boot(page, `place=alps&${VIEW}&style=globe-classes`);
  expect(record.missing).toEqual([]);
  await classesReady(page, "alps");
  const s = await state(page);
  expect(s.farState).toBe("ready");
  expect(s.shaderStyle).toBe(6);
  expect(s.light).toBe(1);
  const ground = await page.evaluate(() => {
    const out = [];
    for (let i = 0; i < 25; i++) {
      for (let j = 0; j < 25; j++) {
        const x = -96_000 + 8_000 * i;
        const y = -96_000 + 8_000 * j;
        const f = window.__terrainLab.fieldAt(x, y);
        const imagery = window.__terrainLab.classAt(x, y);
        if (f && imagery) out.push({ x, y, ...f, ...imagery });
      }
    }
    return out;
  });
  expect(ground.length).toBeGreaterThan(400);
  const at = await page.evaluate(
    (ps) => window.__terrainLab.projectAll(ps),
    ground.map((p) => [p.x, p.heightM - s.datum, -p.y]),
  );
  const px = await readPixels(page, at);
  const gain = LOOK.shade * s.slopeBoost;
  const errs = ground.flatMap((p, i) => {
    const { albedo } = classAlbedo({
      land: p.land,
      water: p.water,
      point: {
        heightM: p.heightM,
        gx: p.gx,
        gy: p.gy,
        smallM: p.smallM,
        latDeg: s.centre.lat,
      },
      widthDE: s.classWidth,
    });
    const want = sunLitColour(
      albedo,
      sunLight(reliefNormal(p.gx, p.gy, gain), s.sun.enu, {
        shadow: LOOK.shadow,
        svf: 1,
      }),
    );
    return want.map((v, c) => Math.abs(Math.round(v * 255) - px[i][c]));
  });
  const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
  console.log(
    `globe-classes against its reference: mean channel error ${mean.toFixed(2)} ` +
      `(${sweepLine(mean, [2, 3, 4, 6, 8])}), worst ${Math.max(...errs)}`,
  );
  expect(mean).toBeLessThanOrEqual(CLASSES_MEAN_TOLERANCE);

  // The prototypes are a starting point read off one tile: log what the
  // region's imagery actually holds per class (the mean land colour of the
  // grid texels each class wins), so a wrong prototype shows.
  const texels = await page.evaluate(() => {
    const out = [];
    for (let i = 0; i < 64; i++) {
      for (let j = 0; j < 64; j++) {
        const c = window.__terrainLab.classAt(
          -126_000 + 4_000 * i,
          -126_000 + 4_000 * j,
        );
        if (c) out.push(c);
      }
    }
    return out;
  });
  const sums = LAND_CLASSES.map(() => ({ n: 0, rgb: [0, 0, 0], w: 0 }));
  let water = 0;
  for (const t of texels) {
    water += t.water;
    const w = landClassWeights(t.land, s.classWidth);
    const k = w.indexOf(Math.max(...w));
    sums[k].n += 1;
    sums[k].w += w[k];
    t.land.forEach((v, c) => (sums[k].rgb[c] += v));
  }
  // The sweep's measured prototypes are these means as logged on
  // 2026-10-01: the ΔE to them shows when the imagery or the class split
  // has moved away from what they were measured on.
  LAND_CLASSES.forEach((name, k) => {
    const m = sums[k];
    const mean = m.rgb.map((v) => v / m.n);
    console.log(
      `globe-classes alps: ${name} wins ${m.n} of ${texels.length} texels` +
        (m.n
          ? `, their mean land colour ${mean.map((v) => v.toFixed(3)).join(", ")} ` +
            `(prototype ${GLOBE_CLASSES.prototypes[name].join(", ")}, ΔE ${deltaE76(mean, GLOBE_CLASSES.prototypes[name]).toFixed(1)}; ` +
            `measured prototype ΔE ${deltaE76(mean, GLOBE_CLASSES.measuredPrototypes[name]).toFixed(1)}), ` +
            `mean winning weight ${(m.w / m.n).toFixed(2)}`
          : ""),
    );
  });
  console.log(
    `globe-classes alps: mean water share ${(water / texels.length).toFixed(4)}`,
  );
  // The water mask: a lake is water in C2's grid; the plain imagery read
  // keeps the colour under the mask (it read near black before the
  // decode fix, terrain-review-fixes.smoke.spec.mjs).
  const lake = await page.evaluate(() => {
    const e = window.__terrainLab.toEnu(47.25, 8.65);
    return {
      imagery: window.__terrainLab.imageryAt(47.25, 8.65),
      classes: e ? window.__terrainLab.classAt(e.x, e.y) : null,
    };
  });
  console.log(
    `Lake Zurich (47.25 N, 8.65 E): plain imagery ${lake.imagery?.map((v) => v.toFixed(3)).join(", ")}, ` +
      `C2 water share ${lake.classes?.water.toFixed(2)}`,
  );
  expect(errors).toEqual([]);
});

test("globe-classes: the class-threshold sweep on the Alps and the Blue Ridge", async ({
  page,
}) => {
  test.setTimeout(420_000);
  await routeAll(page, fixtureTile);
  await boot(page, `place=alps&${VIEW}&style=globe-classes`);
  for (const place of ["alps", "appalachians"]) {
    if (place !== "alps") {
      await applyHash(page, `place=${place}&${VIEW}&style=globe-classes`);
    }
    await classesReady(page, place);
    // The sweep needs the relief too.
    await page.waitForFunction(
      () => window.__terrainLab.state().hasData === true,
      null,
      { timeout: 120_000 },
    );
    const rows = await page.evaluate(() => window.__terrainLab.classSweep());
    expect(rows).not.toBeNull();
    for (const r of rows) {
      const shares = Object.entries(r.shares)
        .map(([k, v]) => `${k} ${(100 * v).toFixed(1)} %`)
        .join(", ");
      console.log(
        `class sweep ${place} ${r.label}: footprint drift ΔE ${r.drift.mean.toFixed(2)} ` +
          `(p95 ${r.drift.p95.toFixed(2)}, n ${r.drift.n}), detail ΔE ${r.detail.toFixed(2)}; ${shares}`,
      );
      expect(Number.isFinite(r.drift.mean)).toBe(true);
      expect(Number.isFinite(r.detail)).toBe(true);
    }
  }
});
