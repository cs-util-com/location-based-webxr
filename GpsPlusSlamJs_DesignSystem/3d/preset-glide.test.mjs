/**
 * The look presets' glide (round-3 plan 2026-09-27-0532, feedback 1 and
 * §8 finding 8), under Node's own runner.
 *
 * Why this test matters: the owner asked that the presets stop jumping and
 * glide over about 5 s, so one can step through the modes. What makes a
 * glide right is invisible in a screenshot of its ends: the easing (a
 * half-way sample cannot tell eased from linear, so t = 0.25 is asserted
 * below linear), the retarget from where the scene IS rather than where the
 * last glide started, the azimuth's short way round (golden hour 265° to
 * dawn 75° turns 170°, not 190° through the south), an end state that is
 * the preset exactly (not a float that rounds to it), and the sky rebuilds
 * limited to every k-th frame with the last frame always rebuilt.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import {
  createPresetGlide,
  GLIDE_MS,
  lerpLook,
  presetLook,
  shortestArcDeg,
} from "./preset-glide.js";

// The page's easing is OsmDemo's smoothstep (served at /osm/easing.js);
// the test runs the same source, not a copy (Node strips its types).
const EASING = join(
  import.meta.dirname,
  "..",
  "..",
  "GpsPlusSlamJs_OsmDemo",
  "src",
  "easing.ts",
);
const { smoothstep } = await import(pathToFileURL(EASING).href);

// The framework's presets' values (look-presets.ts), as the page reads them.
const GOLDEN = {
  id: "golden",
  sunElevationDeg: 5,
  sunAzimuthDeg: 265,
  visibilityKm: 45,
  cloudCover: 0.3,
  exposureEv: -0.3,
};
const NOON = {
  id: "noon",
  sunElevationDeg: 58,
  sunAzimuthDeg: 180,
  visibilityKm: 60,
  cloudCover: 0.2,
  exposureEv: 0,
};
const DAWN = {
  id: "dawn",
  sunElevationDeg: 2,
  sunAzimuthDeg: 75,
  visibilityKm: 30,
  cloudCover: 0.25,
  exposureEv: 0,
};

const glideFrom = (from, to, options = {}) => {
  const glide = createPresetGlide({ ease: smoothstep, ...options });
  glide.start({
    from: presetLook(from),
    to: presetLook(to),
    id: to.id,
    nowMs: 1000,
  });
  return glide;
};

describe("presetLook", () => {
  it("maps a framework preset onto the page's state keys", () => {
    assert.deepEqual(presetLook(GOLDEN), {
      elevation: 5,
      azimuth: 265,
      visibility: 45,
      exposureEv: -0.3,
      clouds: 0.3,
    });
  });
});

describe("shortestArcDeg", () => {
  it("turns the short way round, across north as well", () => {
    // Golden hour to dawn: 265° to 75° is 170° clockwise through north,
    // not 190° back through the south (round-3 plan §8 finding 8).
    assert.equal(shortestArcDeg(265, 75), 170);
    assert.equal(shortestArcDeg(75, 265), -170);
    assert.equal(shortestArcDeg(265, 180), -85);
    assert.equal(shortestArcDeg(350, 10), 20);
    assert.equal(shortestArcDeg(10, 350), -20);
    assert.equal(shortestArcDeg(0, 0), 0);
  });

  it("takes +180 for exactly opposite directions (one fixed choice)", () => {
    assert.equal(shortestArcDeg(0, 180), 180);
    assert.equal(shortestArcDeg(180, 0), 180);
  });
});

describe("lerpLook", () => {
  it("is the start at 0 and the target at 1", () => {
    const a = presetLook(GOLDEN);
    const b = presetLook(NOON);
    assert.deepEqual(lerpLook(a, b, 0), a);
    const end = lerpLook(a, b, 1);
    for (const key of Object.keys(b)) {
      assert.ok(Math.abs(end[key] - b[key]) < 1e-9, key);
    }
  });

  it("moves the azimuth along the short arc and keeps it in [0, 360)", () => {
    const mid = lerpLook(presetLook(GOLDEN), presetLook(DAWN), 0.5);
    // 265 + 85 = 350: through north, not 170 (the long way's half-way).
    assert.ok(Math.abs(mid.azimuth - 350) < 1e-9, `${mid.azimuth}`);
    const later = lerpLook(presetLook(GOLDEN), presetLook(DAWN), 0.75);
    // 265 + 127.5 = 392.5, reported as 32.5.
    assert.ok(Math.abs(later.azimuth - 32.5) < 1e-9, `${later.azimuth}`);
  });

  it("moves the visibility evenly on the slider's log scale", () => {
    // The slider is logarithmic (visibility = 5 * 60^v): an even glide of
    // the slider is a geometric mean at half-way, not the arithmetic one.
    const mid = lerpLook(presetLook(GOLDEN), presetLook(DAWN), 0.5);
    assert.ok(Math.abs(mid.visibility - Math.sqrt(45 * 30)) < 1e-9);
  });

  it("refuses a look with a missing or non-finite value, or a bad fraction", () => {
    const a = presetLook(GOLDEN);
    assert.throws(
      () => lerpLook(a, { ...a, clouds: Number.NaN }, 0.5),
      RangeError,
    );
    assert.throws(() => lerpLook(a, { ...a, visibility: 0 }, 0.5), RangeError);
    const { exposureEv: _dropped, ...partial } = a;
    assert.throws(() => lerpLook(a, partial, 0.5), RangeError);
    assert.throws(() => lerpLook(a, a, Number.NaN), RangeError);
  });
});

describe("createPresetGlide", () => {
  it("takes the owner's 5 s by default", () => {
    assert.equal(GLIDE_MS, 5000);
  });

  it("eases: a quarter of the time moves the look by less than a quarter", () => {
    // A half-way sample cannot see missing easing (any symmetric curve,
    // linear included, is half-way at half time): t = 0.25 can (round-3
    // plan §8 finding 8).
    const glide = glideFrom(GOLDEN, NOON);
    const step = glide.tick(1000 + 0.25 * GLIDE_MS);
    const linear = 5 + 0.25 * (58 - 5);
    assert.ok(
      step.look.elevation < linear - 1,
      `${step.look.elevation} vs ${linear}`,
    );
    assert.ok(step.look.elevation > 5, "it has moved");
    assert.equal(step.done, false);
    // Symmetric: three quarters of the time moves it by more.
    const late = glide.tick(1000 + 0.75 * GLIDE_MS);
    assert.ok(late.look.elevation > 5 + 0.75 * (58 - 5) + 1);
  });

  it("moves every preset value together, on one curve", () => {
    const glide = glideFrom(GOLDEN, NOON);
    const { look } = glide.tick(1000 + 0.4 * GLIDE_MS);
    const s = smoothstep(0.4);
    const expected = lerpLook(presetLook(GOLDEN), presetLook(NOON), s);
    for (const key of Object.keys(expected)) {
      assert.ok(Math.abs(look[key] - expected[key]) < 1e-9, key);
    }
  });

  it("ends on the preset EXACTLY, and then stops", () => {
    const glide = glideFrom(GOLDEN, DAWN);
    glide.tick(1000 + 0.5 * GLIDE_MS);
    const end = glide.tick(1000 + GLIDE_MS + 3);
    assert.equal(end.done, true);
    assert.equal(end.rebuild, true);
    assert.equal(end.id, "dawn");
    // Exact, not "close": 265 + 170 = 435 must come back as 75, and the
    // log-scale visibility must not round to 30.000000000000004.
    assert.deepEqual(end.look, presetLook(DAWN));
    assert.equal(glide.active, false);
    assert.equal(glide.tick(1000 + 2 * GLIDE_MS), null);
  });

  it("retargets from the current state, not from the old start", () => {
    // A new click mid-glide turns toward the new target from where the
    // scene is (round-3 plan §2).
    const glide = glideFrom(GOLDEN, NOON);
    const mid = glide.tick(1000 + 0.5 * GLIDE_MS).look;
    glide.start({
      from: mid,
      to: presetLook(DAWN),
      id: "dawn",
      nowMs: 1000 + 0.5 * GLIDE_MS,
    });
    const first = glide.tick(1000 + 0.5 * GLIDE_MS);
    assert.deepEqual(first.look, mid);
    assert.equal(first.id, "dawn");
    // Five full seconds from the retarget, not from the first click.
    const almost = glide.tick(1000 + 0.5 * GLIDE_MS + GLIDE_MS - 1);
    assert.equal(almost.done, false);
    const end = glide.tick(1000 + 0.5 * GLIDE_MS + GLIDE_MS);
    assert.deepEqual(end.look, presetLook(DAWN));
  });

  it("rebuilds on every k-th frame, the first and the last always", () => {
    const glide = glideFrom(GOLDEN, NOON, { rebuildEvery: 4 });
    const rebuilds = [];
    for (let frame = 0; frame < 10; frame++) {
      rebuilds.push(glide.tick(1000 + frame * 16).rebuild);
    }
    assert.deepEqual(rebuilds, [
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
    ]);
    // The settling frame rebuilds whatever the count.
    const end = glide.tick(1000 + GLIDE_MS);
    assert.equal(end.rebuild, true);
    assert.equal(end.done, true);
  });

  it("a retarget rebuilds on its first frame", () => {
    const glide = glideFrom(GOLDEN, NOON, { rebuildEvery: 8 });
    glide.tick(1000);
    glide.tick(1016);
    const from = glide.tick(1032).look;
    glide.start({ from, to: presetLook(DAWN), id: "dawn", nowMs: 1040 });
    assert.equal(glide.tick(1048).rebuild, true);
  });

  it("holds at the start for a clock that runs backwards", () => {
    const glide = glideFrom(GOLDEN, NOON);
    assert.deepEqual(glide.tick(900).look, presetLook(GOLDEN));
  });

  it("cancels: no more steps until the next start", () => {
    const glide = glideFrom(GOLDEN, NOON);
    glide.tick(1100);
    glide.cancel();
    assert.equal(glide.active, false);
    assert.equal(glide.id, null);
    assert.equal(glide.tick(1200), null);
  });

  it("refuses bad options and a bad start", () => {
    assert.throws(() => createPresetGlide({}), TypeError);
    assert.throws(
      () => createPresetGlide({ ease: smoothstep, durationMs: 0 }),
      RangeError,
    );
    assert.throws(
      () => createPresetGlide({ ease: smoothstep, rebuildEvery: 1.5 }),
      RangeError,
    );
    assert.throws(
      () => createPresetGlide({ ease: smoothstep, rebuildEvery: 0 }),
      RangeError,
    );
    const glide = createPresetGlide({ ease: smoothstep });
    const a = presetLook(GOLDEN);
    assert.throws(
      () => glide.start({ from: a, to: a, id: "golden", nowMs: Number.NaN }),
      RangeError,
    );
    assert.throws(
      () =>
        glide.start({
          from: a,
          to: { ...a, azimuth: Infinity },
          id: "x",
          nowMs: 0,
        }),
      RangeError,
    );
    assert.equal(glide.active, false, "a refused start leaves it idle");
    assert.throws(() => glide.tick(Number.NaN), RangeError);
  });

  // A seeded property check (the package has no fast-check): for random
  // looks, retarget times and frame steps, the glide never leaves the
  // segment between its ends, the azimuth never turns more than 180° per
  // glide, and it always settles on the target exactly.
  it("stays between its ends and settles exactly, for random glides", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const randomLook = () => ({
      elevation: -10 + 80 * random(),
      azimuth: 360 * random(),
      visibility: 5 + 295 * random(),
      exposureEv: -2 + 3 * random(),
      clouds: random(),
    });
    for (let trial = 0; trial < 200; trial++) {
      const rebuildEvery = [1, 2, 4, 8][Math.floor(random() * 4)];
      const glide = createPresetGlide({ ease: smoothstep, rebuildEvery });
      const from = randomLook();
      const to = randomLook();
      let now = 1000 * random();
      glide.start({ from, to, id: "t", nowMs: now });
      const arc = shortestArcDeg(from.azimuth, to.azimuth);
      assert.ok(Math.abs(arc) <= 180);
      let step;
      let travelled = 0;
      let previousAzimuth = from.azimuth;
      do {
        now += 5 + 60 * random();
        step = glide.tick(now);
        const { look } = step;
        for (const key of ["elevation", "exposureEv", "clouds", "visibility"]) {
          const lo = Math.min(from[key], to[key]) - 1e-9;
          const hi = Math.max(from[key], to[key]) + 1e-9;
          assert.ok(look[key] >= lo && look[key] <= hi, `${key} ${look[key]}`);
        }
        assert.ok(look.azimuth >= 0 && look.azimuth < 360, `${look.azimuth}`);
        travelled += Math.abs(shortestArcDeg(previousAzimuth, look.azimuth));
        previousAzimuth = look.azimuth;
      } while (!step.done);
      assert.ok(travelled <= Math.abs(arc) + 1e-6, `${travelled} vs ${arc}`);
      assert.deepEqual(step.look, to);
    }
  });
});
