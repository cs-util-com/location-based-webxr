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
  atmosphereLook,
  defaultAtmosphereSteps,
  ellipsoidToModel,
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
