/**
 * Tests for the terrain lab's styles B, D and E (terrain plan 2026-09-27-0605
 * §4 "Styles", §5 T2, §9 finding 7; research 2026-09-27-0600 §3, §6.2-§6.5).
 *
 * Why this file matters: the shader mirrors these functions, and the smoke
 * holds rendered pixels to the properties pinned here. Each style has one
 * property that makes it that style (B: snow above its line and none below,
 * the line in metres independent of the view; D: higher is lighter, lit
 * slopes warmer than shaded; E: no hue from any shade). A slip in any of them
 * reads on screen as a taste choice, not a bug, so it is pinned here. The
 * latitude rules are held to the numbers the research itself computed from
 * them, not to values derived from this code.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { hexToRgb, rampColour } from "./terrain-style.js";
import {
  CLAY,
  NATURAL,
  SHADER_STYLE,
  SWISS,
  TERRAIN_STYLES,
  clayColour,
  exposureColour,
  naturalBaseColour,
  naturalColour,
  naturalWeights,
  saturation,
  shadeColour,
  singleLightShade,
  snowLineM,
  swissColour,
  treeLineM,
} from "./terrain-styles.js";

const close = (a, b, eps, what) =>
  assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);
const closeRgb = (a, b, eps, what) =>
  a.forEach((v, i) => close(v, b[i], eps, `${what}[${i}]`));

/** A seeded generator, so a failing property case can be replayed. */
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("the style registry", () => {
  // DEC-TR-2 and DEC-TR-6: five styles with the plan's letters A-E.
  // Globe round-5 §3.3 adds the styles coloured from the globe imagery
  // (C1 globe-albedo, C3 globe-bands), each with its own shader branch.
  it("lists A-E in the plan's order, then the imagery styles", () => {
    assert.deepEqual(
      Object.values(TERRAIN_STYLES).map((s) => `${s.letter}:${s.id}`),
      [
        "A:pastel",
        "B:natural",
        "C:globe",
        "D:swiss",
        "E:clay",
        "C1:globe-albedo",
        "C3:globe-bands",
      ],
    );
    assert.equal(SHADER_STYLE["globe-albedo"], 4);
    assert.equal(SHADER_STYLE["globe-bands"], 5);
  });
  it("gives every style a shader branch; C draws as A", () => {
    for (const id of Object.keys(TERRAIN_STYLES)) {
      assert.ok(Number.isInteger(SHADER_STYLE[id]), id);
    }
    assert.equal(SHADER_STYLE.globe, SHADER_STYLE.pastel);
  });
});

describe("style B's cover colour", () => {
  // globe-albedo's detail reads style B's ramp before any light: the
  // refactor must leave style B itself exactly as it was.
  it("is what naturalColour lights and lifts (property)", () => {
    const next = random(77);
    for (let k = 0; k < 300; k++) {
      const p = {
        heightM: -300 + 4500 * next(),
        gx: 2 * (next() - 0.5),
        gy: 2 * (next() - 0.5),
        smallM: 400 * (next() - 0.5),
        latDeg: 46.56,
        svf: 0.6 + 0.4 * next(),
      };
      const s = singleLightShade(p.gx, p.gy, 1, 315, 45);
      const light = Math.min(
        NATURAL.maxLight,
        NATURAL.shadow * s + (1 - NATURAL.shadow) * p.svf,
      );
      const want = naturalBaseColour(p, {}, NATURAL, s)
        .map((v) => v * light)
        .map((v) => Math.min(1, v + (1 - v) * NATURAL.lift));
      closeRgb(naturalColour(p), want, 1e-12, `case ${k}`);
    }
  });
});

describe("the latitude rules (research §3)", () => {
  // The research's own check of its tree-line rule: Alps 47° N 2390 m,
  // Colorado 40° N 3300 m, Canadian Rockies 51° N 1925 m.
  it("reproduces the research's tree-line values", () => {
    assert.equal(treeLineM(47), 2390);
    assert.equal(treeLineM(40), 3300);
    assert.equal(treeLineM(51), 1925);
    assert.equal(treeLineM(10), 3750);
    assert.equal(treeLineM(80), 0);
  });
  it("has a continuous tree line (no step at 30° or 50°)", () => {
    for (const lat of [30, 50]) {
      close(treeLineM(lat - 1e-9), treeLineM(lat), 1e-5, `${lat}°`);
    }
  });
  // "about 4500-5000 m in the tropics, about 3000 m in the Alps (46°), sea
  // level at 70°", linear between.
  it("reproduces the research's snow-line anchors", () => {
    assert.equal(snowLineM(20), 5000);
    assert.equal(snowLineM(30), 5000);
    assert.equal(snowLineM(46), 3000);
    assert.equal(snowLineM(38), 4000);
    assert.equal(snowLineM(70), 0);
    assert.equal(snowLineM(85), 0);
  });
  it("is symmetric about the equator", () => {
    for (const lat of [0, 12, 37.9, 46.56, 53.75, 71]) {
      assert.equal(snowLineM(-lat), snowLineM(lat));
      assert.equal(treeLineM(-lat), treeLineM(lat));
    }
  });
});

describe("singleLightShade", () => {
  it("is exactly 1 on flat ground", () => {
    assert.equal(singleLightShade(0, 0), 1);
    assert.equal(singleLightShade(0, 0, 4), 1);
  });
  // The light is from the north-west: a face whose normal tilts north-west
  // (height rising to the south-east) is lit, its opposite shaded.
  it("lights north-west faces and shades south-east ones", () => {
    assert.ok(singleLightShade(0.3, -0.3) > 1);
    assert.ok(singleLightShade(-0.3, 0.3) < 1);
  });
  it("never goes negative, even on a cliff facing away", () => {
    assert.equal(singleLightShade(-50, 50), 0);
  });
});

/** A flat, open point of style B at a height, with its latitude. */
const flatAt = (heightM, latDeg = 46.56) => ({
  heightM,
  gx: 0,
  gy: 0,
  smallM: 0,
  latDeg,
});

describe("style B's snow (plan §9 finding 7)", () => {
  const S = snowLineM(46.56);
  // The smoke's check, as a rule: snow in full 400 m above the line and none
  // 400 m below, on open ground with no edge noise.
  it("is full 400 m above the line and absent 400 m below", () => {
    assert.equal(naturalWeights(flatAt(S + 400)).snow, 1);
    assert.equal(naturalWeights(flatAt(S - 400)).snow, 0);
  });
  it("moves with the snow offset", () => {
    // The line moves by the offset, the 150 m softening with it.
    assert.equal(naturalWeights(flatAt(S + 400), { snowOffsetM: 550 }).snow, 0);
    assert.equal(
      naturalWeights(flatAt(S - 400), { snowOffsetM: -550 }).snow,
      1,
    );
  });
  // Poleward faces hold snow lower: at a full slope the local line is the
  // aspect term below the line; sun-facing faces hold it higher.
  it("lies lower on poleward faces, higher on sun-facing ones", () => {
    const g = NATURAL.aspectFullSlope;
    const north = { ...flatAt(S), gy: -g }; // height falls to the north
    const south = { ...flatAt(S), gy: g };
    assert.equal(naturalWeights(north).localSnowM, S - NATURAL.aspectSnowM);
    assert.equal(naturalWeights(south).localSnowM, S + NATURAL.aspectSnowM);
    // South of the equator the pole is south.
    const sh = { ...flatAt(S, -46.56), gy: g };
    assert.equal(naturalWeights(sh).localSnowM, S - NATURAL.aspectSnowM);
  });
  // The edge noise bends the line by at most edgeM: a ridge standing 400 m
  // over its surroundings (as Alpine ridges do at z8) gets no snow 400 m
  // below the line, and a gully none above it is left bare.
  it("bends the line by at most the edge width with the small relief", () => {
    assert.equal(naturalWeights({ ...flatAt(S - 400), smallM: 420 }).snow, 0);
    assert.equal(naturalWeights({ ...flatAt(S + 400), smallM: -420 }).snow, 1);
    const w = naturalWeights({ ...flatAt(S - 60), smallM: 120 }).snow;
    assert.ok(w > 0.5, `${w}`);
  });
  it("slides off faces steeper than 60°", () => {
    const steep = { ...flatAt(S + 1000), gx: Math.tan((65 * Math.PI) / 180) };
    const w = naturalWeights(steep, { aspectSnowM: 0 });
    assert.equal(w.snow, 0);
    assert.equal(w.bareAboveSnow, 1);
  });
  // The line is a height in METRES: nothing of the view (the slope boost,
  // the exaggeration) enters the weights, which take no gain at all.
  it("depends on no view parameter", () => {
    // A shaded face (height rising to the north-west), so the gain shows.
    const p = { ...flatAt(S + 100), gx: -0.2, gy: 0.1, smallM: 30 };
    assert.deepEqual(
      naturalWeights(p, { gain: 5, exaggeration: 10 }),
      naturalWeights(p, { gain: 1, exaggeration: 1 }),
    );
    // The gain does reach the colour (the shading), just not the weights.
    assert.notDeepEqual(
      naturalColour(p, { gain: 1, lift: 0 }),
      naturalColour(p, { gain: 5, lift: 0 }),
    );
  });
});

describe("style B's cover below the snow", () => {
  const T = treeLineM(46.56);
  it("is lowland green low down and forest toward the tree line", () => {
    closeRgb(
      naturalColour(flatAt(0.25 * T), { lift: 0 }),
      hexToRgb(NATURAL.lowland),
      1e-12,
      "lowland",
    );
    closeRgb(
      naturalColour(flatAt(T - NATURAL.edgeM), { lift: 0 }),
      hexToRgb(NATURAL.forest),
      1e-12,
      "forest",
    );
  });
  it("is meadow just above the tree line and scree above that", () => {
    const meadow = naturalWeights(flatAt(T + NATURAL.edgeM));
    assert.equal(meadow.meadow, 1);
    assert.equal(meadow.scree, 0);
    assert.equal(naturalWeights(flatAt(T + 460)).scree, 1);
  });
  it("is bare rock on slopes steeper than the rock slope", () => {
    const tan = (deg) => Math.tan((deg * Math.PI) / 180);
    assert.equal(naturalWeights({ ...flatAt(500), gx: tan(42) }).rock, 1);
    assert.equal(naturalWeights({ ...flatAt(500), gx: tan(30) }).rock, 0);
  });
  it("is the sea's colours at and below 0 m", () => {
    closeRgb(
      naturalColour(flatAt(0), { lift: 0 }),
      hexToRgb(NATURAL.sea),
      1e-12,
      "0 m",
    );
    closeRgb(
      naturalColour(flatAt(-500), { lift: 0 }),
      hexToRgb(NATURAL.seaDeep),
      1e-12,
      "-500 m",
    );
  });
  it("lifts toward white by `lift`", () => {
    const at = (lift) => naturalColour(flatAt(300), { lift });
    const base = hexToRgb(NATURAL.lowland);
    closeRgb(
      at(0.4),
      base.map((v) => v + (1 - v) * 0.4),
      1e-12,
      "lift 0.4",
    );
  });
  // Property: every input a region can hold gives a colour in 0-1.
  it("stays within 0-1 for any height, slope and sky view", () => {
    const rand = random(7);
    for (let i = 0; i < 2000; i++) {
      const p = {
        heightM: -500 + rand() * 9500,
        gx: (rand() - 0.5) * 6,
        gy: (rand() - 0.5) * 6,
        smallM: (rand() - 0.5) * 400,
        latDeg: (rand() - 0.5) * 170,
        svf: rand(),
      };
      const col = naturalColour(p, {
        gain: 1 + rand() * 4,
        lift: rand() * 0.4,
      });
      for (const v of col) assert.ok(v >= 0 && v <= 1, `${v} at ${i}`);
    }
  });
});

describe("style D's exposure palette", () => {
  const c = (hex) => hexToRgb(hex);
  it("is the flat colour for a level normal", () => {
    closeRgb(exposureColour(0, 0), c(SWISS.exposureFlat), 1e-12, "flat");
  });
  // The light is from 315°: a normal tilted fully that way is the lit
  // colour, the other way the shaded one, and 90° either side left/right.
  it("reaches each palette colour at a full tilt", () => {
    const t = SWISS.exposureFullTilt;
    const at = (deg) => [
      t * Math.sin((deg * Math.PI) / 180),
      t * Math.cos((deg * Math.PI) / 180),
    ];
    closeRgb(exposureColour(...at(315)), c(SWISS.exposureLight), 1e-9, "lit");
    closeRgb(
      exposureColour(...at(135)),
      c(SWISS.exposureShadow),
      1e-9,
      "shaded",
    );
    closeRgb(exposureColour(...at(45)), c(SWISS.exposureLeft), 1e-9, "left");
    closeRgb(exposureColour(...at(225)), c(SWISS.exposureRight), 1e-9, "right");
  });
});

describe("style D's colour", () => {
  const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const warmth = ([r, , b]) => r - b;
  it("is the ramp itself on flat, open ground", () => {
    for (const h of [10, 700, 2500]) {
      closeRgb(
        swissColour({ heightM: h, gx: 0, gy: 0 }),
        rampColour(SWISS.land, h),
        1e-12,
        `${h} m`,
      );
    }
  });
  // Property: "higher is lighter" on flat ground, over the whole ramp.
  it("is never darker higher up on flat ground", () => {
    let last = -1;
    for (let h = 1; h <= 5000; h += 25) {
      const l = luminance(swissColour({ heightM: h, gx: 0, gy: 0 }));
      assert.ok(l >= last - 1e-12, `${h} m`);
      last = l;
    }
  });
  // Property: a face toward the light is warmer (red minus blue) than the
  // same face turned away, for any slope, height and exposure > 0.
  it("keeps lit slopes warmer than shaded ones", () => {
    const rand = random(11);
    for (let i = 0; i < 500; i++) {
      const g = 0.05 + rand() * 1.5;
      const h = 1 + rand() * 3900;
      const o = { exposure: 0.05 + rand() * 0.65, gain: 1 + rand() * 3 };
      // Toward 315° (NW): height rises to the south-east.
      const lit = swissColour({ heightM: h, gx: g, gy: -g }, o);
      const shaded = swissColour({ heightM: h, gx: -g, gy: g }, o);
      assert.ok(warmth(lit) > warmth(shaded), `case ${i}`);
    }
  });
  // Aerial perspective: the same slope loses less light in the lowlands.
  it("shades the lowlands with less contrast than the peaks", () => {
    const slope = { gx: -0.4, gy: 0.4 };
    const range = { hMinM: 0, hMaxM: 4000 };
    const ratio = (h) =>
      luminance(swissColour({ heightM: h, ...slope }, range)) /
      luminance(swissColour({ heightM: h, gx: 0, gy: 0 }, range));
    assert.ok(ratio(100) > ratio(3900));
  });
});

describe("style E, clay", () => {
  it("is one plain colour on land and one on the sea", () => {
    assert.deepEqual(clayColour(1), hexToRgb(CLAY.land));
    assert.deepEqual(clayColour(4000), hexToRgb(CLAY.land));
    assert.deepEqual(clayColour(0), hexToRgb(CLAY.sea));
  });
  // Plan §9 finding 7 ("E: saturation about 0"): no shade, lift or sky
  // view adds a hue; the land never gets more saturated than the plain
  // colour itself (3.8 %).
  it("gains no saturation from any shade", () => {
    const base = clayColour(500);
    const limit = saturation(base) + 1e-9;
    const rand = random(3);
    for (let i = 0; i < 2000; i++) {
      const col = shadeColour(base, rand() * 2.5, rand(), CLAY);
      assert.ok(saturation(col) <= limit, `${saturation(col)} at ${i}`);
    }
    assert.ok(saturation(base) < 0.04);
  });
});

describe("saturation", () => {
  it("is 0 for greys and 1 for a pure hue", () => {
    assert.equal(saturation([0.5, 0.5, 0.5]), 0);
    assert.equal(saturation([0, 0, 0]), 0);
    assert.equal(saturation([1, 0, 0]), 1);
  });
});
