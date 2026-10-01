/**
 * Tests for the terrain lab's style `globe-classes` (C2; globe round-5 plan
 * 2026-10-01-0945 §3.3).
 *
 * Why this file matters: C2's whole claim is that the imagery decides HOW
 * MUCH of each class an imagery pixel holds and the relief decides WHERE
 * inside the pixel each class goes. Each half is pinned here before a pixel
 * is drawn: the weights follow the colour (and the water mask), the
 * affinities follow the lines (snow high, rock steep, water flat), and when
 * the relief has no preference the style IS the imagery, so the hand-over
 * to the globe holds. The sweep's arithmetic is checked on a synthetic
 * region whose answer is known.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { srgbToLinear } from "./terrain-far-field.js";
import { deltaE76 } from "./terrain-globe-colour.js";
import { snowLineM, treeLineM } from "./terrain-styles.js";
import { sunLitColour } from "./terrain-sun.js";
import {
  CLASS_SWEEP,
  GLOBE_CLASSES,
  LAND_CLASSES,
  classAffinities,
  classAlbedo,
  classSweep,
  coarseClassColour,
  globeClassesColour,
  landClassWeights,
} from "./terrain-globe-classes.js";

const close = (a, b, eps, what) =>
  assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);

/** A seeded generator, so a failing property case can be replayed. */
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const LAT = 46.56;
const TREE = treeLineM(LAT);
const SNOW = snowLineM(LAT);
const flat = (heightM) => ({ heightM, gx: 0, gy: 0, smallM: 0, latDeg: LAT });
const steep = (heightM) => ({
  heightM,
  gx: 1.5,
  gy: 0,
  smallM: 0,
  latDeg: LAT,
});

describe("C2: the coarse weights follow the imagery's colour", () => {
  it("sum to 1 and give each prototype to its own class", () => {
    LAND_CLASSES.forEach((name, i) => {
      const w = landClassWeights(GLOBE_CLASSES.prototypes[name]);
      close(
        w.reduce((a, b) => a + b, 0),
        1,
        1e-12,
        name,
      );
      assert.equal(w.indexOf(Math.max(...w)), i, name);
    });
  });

  it("are non-negative and sum to 1 for any colour (property)", () => {
    const next = random(3);
    for (let k = 0; k < 500; k++) {
      const w = landClassWeights([next(), next(), next()], 4 + next() * 30);
      assert.ok(
        w.every((v) => v >= 0 && v <= 1),
        `case ${k}`,
      );
      close(
        w.reduce((a, b) => a + b, 0),
        1,
        1e-9,
        `case ${k}`,
      );
    }
  });

  it("go wholly to the nearest class for a colour far from all of them", () => {
    const w = landClassWeights([1, 0, 1], 4);
    assert.equal(w.filter((v) => v === 1).length, 1);
  });

  it("refuses a width that is not positive", () => {
    assert.throws(() => landClassWeights([0.3, 0.3, 0.3], 0), RangeError);
  });
});

describe("C2: the affinities follow the relief", () => {
  it("put snow above the snow line and not below it", () => {
    const high = classAffinities(flat(SNOW + 600)).land[3];
    const low = classAffinities(flat(SNOW - 600)).land[3];
    assert.ok(high > 0.9 && low < 0.1, `${high} ${low}`);
  });

  it("put rock on steep ground and keep forest and grass off it", () => {
    const s = classAffinities(steep(1000)).land;
    const f = classAffinities(flat(1000)).land;
    assert.ok(s[2] > 0.9 && f[2] < 0.1, `rock ${s[2]} ${f[2]}`);
    assert.ok(s[0] < 0.1 && f[0] > 0.9, `forest ${s[0]} ${f[0]}`);
    assert.ok(s[1] < 0.1 && f[1] > 0.9, `grass ${s[1]} ${f[1]}`);
  });

  it("put forest below the tree line only", () => {
    assert.ok(classAffinities(flat(TREE - 600)).land[0] > 0.9);
    assert.ok(classAffinities(flat(TREE + 600)).land[0] < 0.1);
  });

  it("put water on flat ground, and only water at sea level", () => {
    assert.ok(classAffinities(flat(400)).water > 0.9);
    assert.ok(classAffinities(steep(400)).water < 0.1);
    const sea = classAffinities(flat(-5));
    assert.equal(sea.water, 1);
    assert.deepEqual(sea.land, Array(4).fill(GLOBE_CLASSES.floor));
  });

  it("never fall below the floor nor above 1 (property)", () => {
    const next = random(5);
    for (let k = 0; k < 500; k++) {
      const p = {
        heightM: next() * 4500,
        gx: (next() - 0.5) * 3,
        gy: (next() - 0.5) * 3,
        smallM: (next() - 0.5) * 400,
        latDeg: LAT,
      };
      const a = classAffinities(p);
      for (const v of [...a.land, a.water]) {
        assert.ok(v >= GLOBE_CLASSES.floor - 1e-12 && v <= 1 + 1e-12, `${k}`);
      }
    }
  });
});

describe("C2: the albedo", () => {
  // The hand-over property: where the relief prefers no class over another
  // (every affinity equal: a floor of 1), the fine weights ARE the coarse
  // ones and the albedo is the imagery's colour, as the globe draws it.
  it("is the imagery's colour where the relief has no preference (property)", () => {
    const next = random(7);
    for (let k = 0; k < 300; k++) {
      const land = [next(), next(), next()];
      const water = next() < 0.3 ? next() : 0;
      const p = {
        heightM: next() * 4500,
        gx: (next() - 0.5) * 3,
        gy: (next() - 0.5) * 3,
        smallM: 0,
        latDeg: LAT,
      };
      const out = classAlbedo({ land, water, point: p, o: { floor: 1 } });
      const want = coarseClassColour(land, water);
      assert.ok(deltaE76(out.albedo, want) < 0.05, `case ${k}`);
    }
  });

  it("whitens the snowy share of a pixel on its high posts and greys it on its steep ones", () => {
    // A grey-green Alpine pixel: some snow, some rock, some grass.
    const land = [0.42, 0.44, 0.4];
    const high = classAlbedo({ land, water: 0, point: flat(SNOW + 500) });
    const low = classAlbedo({ land, water: 0, point: flat(TREE + 200) });
    const y = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    assert.ok(y(high.albedo) > y(land), `${high.albedo} vs ${land}`);
    assert.ok(high.land[3] > low.land[3]);
    const rocky = classAlbedo({ land, water: 0, point: steep(TREE + 200) });
    assert.ok(rocky.land[2] > low.land[2]);
  });

  it("sends a pixel's water share to its flat posts", () => {
    const land = GLOBE_CLASSES.prototypes.grass;
    const onFlat = classAlbedo({ land, water: 0.4, point: flat(400) });
    const onSteep = classAlbedo({ land, water: 0.4, point: steep(400) });
    // The classes compete by their affinities: on flat ground the grass is
    // as welcome as the water, so the water keeps about its share; on a
    // steep post both are at the floor and only rock is welcome, so the
    // pixel's water goes to its flat posts (measured 0.44 against 0.15).
    assert.ok(onFlat.water > 0.39, `flat ${onFlat.water}`);
    assert.ok(
      onFlat.water > onSteep.water + 0.2,
      `${onFlat.water} ${onSteep.water}`,
    );
    assert.deepEqual(
      classAlbedo({ land: null, water: 1, point: steep(400) }).albedo,
      [...GLOBE_CLASSES.water],
    );
  });

  it("has fine weights that sum to 1 and a clamped ratio (property)", () => {
    const next = random(9);
    for (let k = 0; k < 300; k++) {
      const land = [next(), next(), next()];
      const water = next() < 0.3 ? next() : 0;
      const p = {
        heightM: next() * 4500,
        gx: (next() - 0.5) * 3,
        gy: (next() - 0.5) * 3,
        smallM: 0,
        latDeg: LAT,
      };
      const out = classAlbedo({ land, water, point: p });
      close(
        out.land.reduce((a, b) => a + b, 0) + out.water,
        1,
        1e-9,
        `case ${k}`,
      );
      if (water === 0) {
        const [lo, hi] = GLOBE_CLASSES.ratioRange;
        out.albedo.forEach((v, c) => {
          const r = srgbToLinear(v) / Math.max(srgbToLinear(land[c]), 1e-9);
          if (srgbToLinear(land[c]) > 1e-3 && v < 0.999) {
            // 1e-3: the 8-bit-free sRGB round trip (exponent 0.41666).
            assert.ok(r >= lo - 1e-3 && r <= hi + 1e-3, `case ${k}: ${r}`);
          }
        });
      }
    }
  });

  it("is lit by the sun term as the globe lights its pixels", () => {
    const input = { land: [0.3, 0.35, 0.2], water: 0, point: flat(800) };
    assert.deepEqual(
      globeClassesColour(input, 0.7),
      sunLitColour(classAlbedo(input).albedo, 0.7),
    );
  });

  it("composes the coarse colour of land and water in linear light", () => {
    assert.deepEqual(
      coarseClassColour([0.3, 0.3, 0.3], 0).map((v) => +v.toFixed(3)),
      [0.3, 0.3, 0.3],
    );
    assert.deepEqual(coarseClassColour(null, 1), [...GLOBE_CLASSES.water]);
  });
});

describe("C2: the class-threshold sweep", () => {
  /** A synthetic region: a ramp from valley to peak, one imagery colour. */
  function region(colour, water = 0) {
    const side = 41;
    const n = side * side;
    const height = new Float64Array(n);
    const gx = new Float64Array(n);
    const gy = new Float64Array(n);
    for (let r = 0; r < side; r++) {
      for (let c = 0; c < side; c++) {
        // Rises east to 4000 m, with ridges every few posts.
        height[r * side + c] = 500 + c * 85 + 300 * Math.sin(r / 2);
        gx[r * side + c] = 85 / 500;
        gy[r * side + c] = (300 * Math.cos(r / 2)) / 2 / 500;
      }
    }
    return {
      posts: {
        side,
        spacingM: 500,
        extentM: 10_000,
        height,
        gx,
        gy,
        small: new Float64Array(n),
        valid: new Uint8Array(n).fill(1),
      },
      datum: 0,
      latDeg: LAT,
      halfM: 9000,
      footprint: [1700, 2450],
      coarseSide: 8,
      imageryAt: () => ({ land: colour, water }),
    };
  }

  it("reports drift, detail and class shares for each setting", () => {
    const rows = classSweep(region([0.42, 0.44, 0.4]), CLASS_SWEEP);
    assert.equal(rows.length, CLASS_SWEEP.length);
    for (const r of rows) {
      assert.ok(r.posts > 1000, r.label);
      assert.ok(r.drift.n > 10 && Number.isFinite(r.drift.mean), r.label);
      assert.ok(r.detail > 0, r.label);
      close(
        Object.values(r.shares).reduce((a, b) => a + b, 0),
        1,
        1e-9,
        r.label,
      );
    }
    // A lower snow line puts more of the region under snow.
    const share = (label) => rows.find((r) => r.label === label).shares.snow;
    assert.ok(share("snow line -600 m") > share("snow line +600 m"));
  });

  // Where the relief prefers nothing (a single class's colour), the fine
  // albedo is the imagery everywhere: no drift, no detail.
  it("measures no drift and no detail where one class fills the imagery", () => {
    const [row] = classSweep(region(GLOBE_CLASSES.prototypes.rock), [
      { label: "rock", widthDE: 4 },
    ]);
    assert.ok(row.drift.mean < 0.5, `${row.drift.mean}`);
    assert.ok(row.detail < 0.5, `${row.detail}`);
  });
});
