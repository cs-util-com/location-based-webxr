/**
 * The globe atmosphere's frame and look (round-4 plan 2026-09-28-2105
 * DEC-GL4-4).
 *
 * Why this file matters: the pass intersects the model's ground and top
 * SPHERES analytically, while the globe is the WGS84 ELLIPSOID. The frame
 * map is what makes the two meet: every point on the ellipsoid must land on
 * the ground sphere (or the rim would float above the poles or sink into
 * the equator by up to 21 km, a fifth of the air's thickness), and a
 * camera's altitude must map to about the same altitude in the model, or
 * the halo's width would be wrong. The look's numbers come from the hash,
 * so a malformed one must be refused rather than compiled into a shader.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  GLOBE_ATMOSPHERE,
  atmosphereCostText,
  atmosphereLook,
  defaultAtmosphereSteps,
  ellipsoidToModel,
  grazingCompensation,
  lowestPointMu,
  observerAltitudeKm,
} from "./globe-atmosphere-frame.js";

const WGS84 = [6378137, 6378137, 6356752.314245];
const GROUND_KM = 6360;

describe("ellipsoidToModel", () => {
  it("puts every point of the ellipsoid on the model's ground sphere", () => {
    const k = ellipsoidToModel(WGS84, GROUND_KM);
    for (let lat = -90; lat <= 90; lat += 7.5) {
      for (let lon = -180; lon < 180; lon += 15) {
        const la = (lat * Math.PI) / 180;
        const lo = (lon * Math.PI) / 180;
        // A point on the ellipsoid by its parametric latitude.
        const p = [
          WGS84[0] * Math.cos(la) * Math.cos(lo),
          WGS84[1] * Math.cos(la) * Math.sin(lo),
          WGS84[2] * Math.sin(la),
        ];
        const r = Math.hypot(p[0] * k[0], p[1] * k[1], p[2] * k[2]);
        assert.ok(Math.abs(r - GROUND_KM) < 1e-6, `${lat},${lon}: ${r}`);
      }
    }
  });

  it("keeps an altitude within 0.4 % in the model (the flattening)", () => {
    const k = ellipsoidToModel(WGS84, GROUND_KM);
    for (const [axis, radius] of [
      [0, WGS84[0]],
      [2, WGS84[2]],
    ]) {
      const p = [0, 0, 0];
      p[axis] = radius + 100_000;
      const r = Math.hypot(p[0] * k[0], p[1] * k[1], p[2] * k[2]);
      const altKm = r - GROUND_KM;
      assert.ok(Math.abs(altKm - 100) / 100 < 0.004, `axis ${axis}: ${altKm}`);
    }
  });

  it("refuses a radius that is not a positive finite number", () => {
    for (const bad of [
      [0, 1, 1],
      [1, -1, 1],
      [1, 1, Number.NaN],
      [1, Infinity, 1],
    ]) {
      assert.throws(() => ellipsoidToModel(bad, GROUND_KM), RangeError);
    }
    assert.throws(() => ellipsoidToModel(WGS84, 0), RangeError);
  });
});

// Why (review B5): the march costs x3.4-4.6 of a frame on the CPU
// rasteriser at a phone's pixel ratios, and banding was measured fine from
// 6 samples up, so a touch device starts at fewer samples; the slider
// still reaches the rest.
describe("defaultAtmosphereSteps", () => {
  it("is fewer samples on a coarse pointer (a phone) than on a mouse", () => {
    assert.equal(defaultAtmosphereSteps(false), GLOBE_ATMOSPHERE.steps);
    assert.equal(defaultAtmosphereSteps(true), GLOBE_ATMOSPHERE.coarseSteps);
    assert.ok(GLOBE_ATMOSPHERE.coarseSteps < GLOBE_ATMOSPHERE.steps);
    assert.ok(GLOBE_ATMOSPHERE.coarseSteps >= 6, "banding measured from 6 up");
  });
});

// Why (review B2, DEC-GL4-11): reading the air at h / k with steps
// weighted 1 / k keeps a VERTICAL ray's optical depth, but a grazing ray
// through a k times thicker shell holds only 1 / sqrt(k) of it, so the
// limb and the halo would turn thinner and bluer as the slider widens
// them (measured: the halo's chromaticity moved 0.09-0.11 between k = 1,
// 6 and 10). The compensation multiplies a ray's steps by the ratio of
// Chapman's grazing function at the two scale heights: sqrt(k) at the
// limb, 1 for a steep ray and for k = 1, so only the width changes.
describe("grazingCompensation", () => {
  const X = 6360 / 8; // the ground radius over the Rayleigh scale height
  const XM = 6360 / 1.2; // and over the Mie scale height

  it("is exactly 1 at the physical thickness, for every ray", () => {
    for (const mu of [0, 0.01, 0.1, 0.5, 1]) {
      assert.equal(grazingCompensation(1, mu, X), 1);
    }
  });

  // Review m3 (2026-10-01): Chapman's approximation is itself 1-3 % off
  // for a vertical ray, which read as a 1.04-1.06 "curvature" weight; the
  // weight is normalised by its value straight down, so a vertical ray
  // keeps the real air's optical depth exactly.
  it("is exactly 1 straight down, for every thickness", () => {
    for (const k of [1, 2, 6, 10]) {
      for (const x of [X, XM]) {
        assert.ok(Math.abs(grazingCompensation(k, 1, x) - 1) < 1e-12, `k ${k}`);
      }
    }
  });

  it("is sqrt(k) at the limb, less the vertical normalisation (within 6 %)", () => {
    for (const k of [2, 6, 10]) {
      const f = grazingCompensation(k, 0, X);
      assert.ok(f < Math.sqrt(k) && f > Math.sqrt(k) / 1.06, `k ${k}: ${f}`);
    }
  });

  it("falls monotonically from the limb to a steep ray", () => {
    let previous = Infinity;
    for (let mu = 0; mu <= 1; mu += 0.01) {
      const f = grazingCompensation(6, mu, X);
      assert.ok(f <= previous + 1e-12, `mu ${mu}: ${f} after ${previous}`);
      previous = f;
    }
  });
});

// Why (review M1, 2026-10-01): the weight belongs to a ray's LOWEST point
// in the air. From space that is the limb's tangent point (mu 0) or the
// ground hit; but from INSIDE the shell (the dive's last 150 km, and the
// one-scene flight) a ray going up has its lowest point at the camera,
// where it climbs steeply: with the tangent-point rule it got sqrt(k),
// about 2.45 times the intended optical depth at k = 6.
describe("lowestPointMu", () => {
  const G = 6360;
  const up = [0, 0, 1];

  it("is 0 at the tangent point of a ray from space that passes the ground", () => {
    const o = [-20000, 0, G + 30];
    const dir = [1, 0, 0];
    assert.ok(Math.abs(lowestPointMu(o, dir, 0, 40000)) < 1e-9);
  });

  it("is the ray's slant at the ground where it hits the ground", () => {
    const o = [0, 0, G + 1000];
    const dir = [0, 0, -1];
    assert.ok(Math.abs(lowestPointMu(o, dir, 0, 1000) - 1) < 1e-9);
  });

  it("is the ray's climb at the camera when the camera is its lowest point", () => {
    const o = [0, 0, G + 150];
    for (const [dir, mu] of [
      [up, 1],
      [[Math.SQRT1_2, 0, Math.SQRT1_2], Math.SQRT1_2],
    ]) {
      const got = lowestPointMu(o, dir, 0, 500);
      assert.ok(Math.abs(got - mu) < 1e-9, `${dir}: ${got}`);
    }
  });

  it("is 0 for a level ray from inside (its lowest point is the camera, grazing)", () => {
    assert.ok(
      Math.abs(lowestPointMu([0, 0, G + 150], [1, 0, 0], 0, 5000)) < 1e-9,
    );
  });
});

// Why (review 2026-10-01, M2): the march's cost was only ever measured
// on the CPU rasteriser; on a phone it is unmeasured. The lab measures it
// on the device and shows one line (on / off frame time, medians), which
// must say plainly when it cannot measure rather than print NaN.
describe("atmosphereCostText", () => {
  it("names both medians and their ratio, to a tenth of a ms", () => {
    assert.equal(
      atmosphereCostText({
        supported: true,
        onMs: [9, 8.04, 12],
        offMs: [4, 4.4, 3],
      }),
      "Atmosphere: 9.0 ms a frame on, 4.0 ms off (x2.25)",
    );
  });
  it("says when the pass is not supported or the timings are unusable", () => {
    assert.equal(
      atmosphereCostText({ supported: false, onMs: [], offMs: [] }),
      "Atmosphere: not supported on this device (no float render targets)",
    );
    for (const bad of [
      { supported: true, onMs: [], offMs: [1] },
      { supported: true, onMs: [Number.NaN], offMs: [1] },
      { supported: true, onMs: [1], offMs: [0] },
    ]) {
      assert.equal(
        atmosphereCostText(bad),
        "Atmosphere: the frame timing failed",
      );
    }
  });
});

describe("atmosphereLook", () => {
  it("fills every missing value from the defaults", () => {
    assert.deepEqual(atmosphereLook({}), {
      steps: GLOBE_ATMOSPHERE.steps,
      strength: GLOBE_ATMOSPHERE.strength,
      thickness: GLOBE_ATMOSPHERE.thickness,
    });
  });

  it("keeps values inside their ranges and rounds the steps", () => {
    assert.deepEqual(
      atmosphereLook({ steps: 7.6, strength: 2.5, thickness: 3 }),
      { steps: 8, strength: 2.5, thickness: 3 },
    );
  });

  // The steps become a shader constant (a loop bound): a NaN or 0 would
  // fail the compile or draw nothing, silently.
  it("refuses values outside their ranges", () => {
    for (const bad of [
      { steps: 1 },
      { steps: 65 },
      { steps: Number.NaN },
      { strength: -0.1 },
      { strength: Infinity },
      { thickness: 0.5 },
      { thickness: 11 },
    ]) {
      assert.throws(() => atmosphereLook(bad), RangeError, JSON.stringify(bad));
    }
  });
});

// WHY (F2 plan 2026-10-03-1922, "the radius mapping and the observer's
// altitude"): the ground sky's observer is the camera's height above the
// ELLIPSOID's image in the model (not above the exaggerated ground), and
// the space pass reads the same number, from this one place (DEC-H3).
describe("observerAltitudeKm", () => {
  it("is the height over the ellipsoid in the model, at the equator and the pole", () => {
    const [a, , c] = WGS84;
    const equator = observerAltitudeKm([a + 40_000, 0, 0], WGS84, GROUND_KM);
    assert.ok(Math.abs(equator - 40 * (GROUND_KM / (a / 1000))) < 1e-6);
    const pole = observerAltitudeKm([0, 0, c + 10_000], WGS84, GROUND_KM);
    assert.ok(Math.abs(pole - 10 * (GROUND_KM / (c / 1000))) < 1e-6);
    assert.ok(Math.abs(observerAltitudeKm([a, 0, 0], WGS84, GROUND_KM)) < 1e-9);
  });

  it("is negative below the ellipsoid, and refuses a non-finite position", () => {
    assert.ok(
      observerAltitudeKm([WGS84[0] - 1000, 0, 0], WGS84, GROUND_KM) < 0,
    );
    assert.throws(
      () => observerAltitudeKm([Number.NaN, 0, 0], WGS84, GROUND_KM),
      RangeError,
    );
  });
});
