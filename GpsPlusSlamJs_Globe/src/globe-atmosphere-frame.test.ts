/**
 * The globe atmosphere's frame and look (round-4 plan 2026-09-28-2105
 * DEC-GL4-4), moved with the module from the globe lab.
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
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  CHAPMAN_GLSL,
  GLOBE_ATMOSPHERE,
  atmosphereCostText,
  atmosphereLook,
  defaultAtmosphereSteps,
  ellipsoidToModel,
  grazingCompensation,
  lowestPointMu,
  observerAltitudeKm,
} from "./globe-atmosphere-frame.js";

type Vec3 = [number, number, number];

const WGS84: Vec3 = [6378137, 6378137, 6356752.314245];
const GROUND_KM = 6360;

/** A point on the WGS84 ellipsoid by its parametric latitude. */
const onEllipsoid = (latDeg: number, lonDeg: number): Vec3 => {
  const la = (latDeg * Math.PI) / 180;
  const lo = (lonDeg * Math.PI) / 180;
  return [
    WGS84[0] * Math.cos(la) * Math.cos(lo),
    WGS84[1] * Math.cos(la) * Math.sin(lo),
    WGS84[2] * Math.sin(la),
  ];
};

describe("ellipsoidToModel", () => {
  it("puts every point of the ellipsoid on the model's ground sphere", () => {
    const k = ellipsoidToModel(WGS84, GROUND_KM);
    for (let lat = -90; lat <= 90; lat += 7.5) {
      for (let lon = -180; lon < 180; lon += 15) {
        const p = onEllipsoid(lat, lon);
        const r = Math.hypot(p[0] * k[0], p[1] * k[1], p[2] * k[2]);
        expect(Math.abs(r - GROUND_KM), `${lat},${lon}: ${r}`).toBeLessThan(
          1e-6,
        );
      }
    }
  });

  it("keeps an altitude within 0.4 % in the model (the flattening)", () => {
    const k = ellipsoidToModel(WGS84, GROUND_KM);
    for (const [axis, radius] of [
      [0, WGS84[0]],
      [2, WGS84[2]],
    ] as const) {
      const p: Vec3 = [0, 0, 0];
      p[axis] = radius + 100_000;
      const r = Math.hypot(p[0] * k[0], p[1] * k[1], p[2] * k[2]);
      const altKm = r - GROUND_KM;
      expect(Math.abs(altKm - 100) / 100, `axis ${axis}`).toBeLessThan(0.004);
    }
  });

  it("refuses a radius that is not a positive finite number", () => {
    const bads: Vec3[] = [
      [0, 1, 1],
      [1, -1, 1],
      [1, 1, Number.NaN],
      [1, Infinity, 1],
    ];
    for (const bad of bads) {
      expect(() => ellipsoidToModel(bad, GROUND_KM)).toThrow(RangeError);
    }
    expect(() => ellipsoidToModel(WGS84, 0)).toThrow(RangeError);
  });
});

// Why (review B5): the march costs x3.4-4.6 of a frame on the CPU
// rasteriser at a phone's pixel ratios, and banding was measured fine from
// 6 samples up, so a touch device starts at fewer samples; the slider
// still reaches the rest.
describe("defaultAtmosphereSteps", () => {
  it("is fewer samples on a coarse pointer (a phone) than on a mouse", () => {
    expect(defaultAtmosphereSteps(false)).toBe(GLOBE_ATMOSPHERE.steps);
    expect(defaultAtmosphereSteps(true)).toBe(GLOBE_ATMOSPHERE.coarseSteps);
    expect(GLOBE_ATMOSPHERE.coarseSteps).toBeLessThan(GLOBE_ATMOSPHERE.steps);
    // Banding was measured from 6 up.
    expect(GLOBE_ATMOSPHERE.coarseSteps).toBeGreaterThanOrEqual(6);
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
      expect(grazingCompensation(1, mu, X)).toBe(1);
    }
  });

  // Review m3 (2026-10-01): Chapman's approximation is itself 1-3 % off
  // for a vertical ray, which read as a 1.04-1.06 "curvature" weight; the
  // weight is normalised by its value straight down, so a vertical ray
  // keeps the real air's optical depth exactly.
  it("is exactly 1 straight down, for every thickness", () => {
    for (const k of [1, 2, 6, 10]) {
      for (const x of [X, XM]) {
        expect(
          Math.abs(grazingCompensation(k, 1, x) - 1),
          `k ${k}`,
        ).toBeLessThan(1e-12);
      }
    }
  });

  it("is sqrt(k) at the limb, less the vertical normalisation (within 6 %)", () => {
    for (const k of [2, 6, 10]) {
      const f = grazingCompensation(k, 0, X);
      expect(f).toBeLessThan(Math.sqrt(k));
      expect(f).toBeGreaterThan(Math.sqrt(k) / 1.06);
    }
  });

  it("falls monotonically from the limb to a steep ray", () => {
    let previous = Infinity;
    for (let mu = 0; mu <= 1; mu += 0.01) {
      const f = grazingCompensation(6, mu, X);
      expect(f, `mu ${mu}`).toBeLessThanOrEqual(previous + 1e-12);
      previous = f;
    }
  });

  // The same two bounds for any thickness and ray: never below the real
  // air's depth, never above the limb's sqrt(k).
  it("stays between 1 and sqrt(k) for every thickness and ray", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 10, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (k, mu) => {
          const f = grazingCompensation(k, mu, X);
          expect(f).toBeGreaterThanOrEqual(1 - 1e-12);
          expect(f).toBeLessThanOrEqual(Math.sqrt(k) + 1e-12);
        },
      ),
    );
  });
});

// Why (review M1, 2026-10-01): the weight belongs to a ray's LOWEST point
// in the air. From space that is the limb's tangent point (mu 0) or the
// ground hit; but from INSIDE the shell (the dive's last 150 km, and the
// one-scene flight) a ray going up has its lowest point at the camera,
// where it climbs steeply: with the tangent-point rule it got sqrt(k),
// about 2.45 times the intended optical depth at k = 6.
// The pass's march (the lab's globe-atmosphere.js) calls the GLSL twins by
// these names; a renamed or dropped twin would fail only in a browser.
describe("CHAPMAN_GLSL", () => {
  it("declares the twins the march calls, with the same pi", () => {
    for (const name of [
      "float atmChapman( float x, float mu )",
      "float atmGrazingCompensation( float k, float mu, float x )",
      "float atmLowestPointMu( vec3 o, vec3 dir, float tEnter, float tEnd )",
    ]) {
      expect(CHAPMAN_GLSL).toContain(name);
    }
    expect(CHAPMAN_GLSL).toContain(String(Math.PI));
  });
});

describe("lowestPointMu", () => {
  const G = 6360;
  const up: Vec3 = [0, 0, 1];

  it("is 0 at the tangent point of a ray from space that passes the ground", () => {
    const o: Vec3 = [-20000, 0, G + 30];
    const dir: Vec3 = [1, 0, 0];
    expect(Math.abs(lowestPointMu(o, dir, 0, 40000))).toBeLessThan(1e-9);
  });

  it("is the ray's slant at the ground where it hits the ground", () => {
    const o: Vec3 = [0, 0, G + 1000];
    const dir: Vec3 = [0, 0, -1];
    expect(Math.abs(lowestPointMu(o, dir, 0, 1000) - 1)).toBeLessThan(1e-9);
  });

  it("is the ray's climb at the camera when the camera is its lowest point", () => {
    const o: Vec3 = [0, 0, G + 150];
    const cases: [Vec3, number][] = [
      [up, 1],
      [[Math.SQRT1_2, 0, Math.SQRT1_2], Math.SQRT1_2],
    ];
    for (const [dir, mu] of cases) {
      const got = lowestPointMu(o, dir, 0, 500);
      expect(Math.abs(got - mu), dir.join(",")).toBeLessThan(1e-9);
    }
  });

  it("is 0 for a level ray from inside (its lowest point is the camera, grazing)", () => {
    expect(
      Math.abs(lowestPointMu([0, 0, G + 150], [1, 0, 0], 0, 5000)),
    ).toBeLessThan(1e-9);
  });
});

// Why (review 2026-10-01, M2): the march's cost was only ever measured
// on the CPU rasteriser; on a phone it is unmeasured. The lab measures it
// on the device and shows one line (on / off frame time, medians), which
// must say plainly when it cannot measure rather than print NaN.
describe("atmosphereCostText", () => {
  it("names both medians and their ratio, to a tenth of a ms", () => {
    expect(
      atmosphereCostText({
        supported: true,
        onMs: [9, 8.04, 12],
        offMs: [4, 4.4, 3],
      }),
    ).toBe("Atmosphere: 9.0 ms a frame on, 4.0 ms off (x2.25)");
  });
  it("says when the pass is not supported or the timings are unusable", () => {
    expect(atmosphereCostText({ supported: false, onMs: [], offMs: [] })).toBe(
      "Atmosphere: not supported on this device (no float render targets)",
    );
    for (const bad of [
      { supported: true, onMs: [], offMs: [1] },
      { supported: true, onMs: [Number.NaN], offMs: [1] },
      { supported: true, onMs: [1], offMs: [0] },
    ]) {
      expect(atmosphereCostText(bad)).toBe(
        "Atmosphere: the frame timing failed",
      );
    }
  });
});

describe("atmosphereLook", () => {
  it("fills every missing value from the defaults", () => {
    expect(atmosphereLook({})).toEqual({
      steps: GLOBE_ATMOSPHERE.steps,
      strength: GLOBE_ATMOSPHERE.strength,
      thickness: GLOBE_ATMOSPHERE.thickness,
    });
  });

  it("keeps values inside their ranges and rounds the steps", () => {
    expect(atmosphereLook({ steps: 7.6, strength: 2.5, thickness: 3 })).toEqual(
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
      expect(() => atmosphereLook(bad), JSON.stringify(bad)).toThrow(
        RangeError,
      );
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
    expect(Math.abs(equator - 40 * (GROUND_KM / (a / 1000)))).toBeLessThan(
      1e-6,
    );
    const pole = observerAltitudeKm([0, 0, c + 10_000], WGS84, GROUND_KM);
    expect(Math.abs(pole - 10 * (GROUND_KM / (c / 1000)))).toBeLessThan(1e-6);
    expect(
      Math.abs(observerAltitudeKm([a, 0, 0], WGS84, GROUND_KM)),
    ).toBeLessThan(1e-9);
  });

  it("is negative below the ellipsoid, and refuses a non-finite position", () => {
    expect(
      observerAltitudeKm([WGS84[0] - 1000, 0, 0], WGS84, GROUND_KM),
    ).toBeLessThan(0);
    expect(() =>
      observerAltitudeKm([Number.NaN, 0, 0], WGS84, GROUND_KM),
    ).toThrow(RangeError);
  });

  // Every point of the ellipsoid is the observer's ground: 0, wherever.
  it("is 0 anywhere on the ellipsoid", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (lat, lon) => {
          expect(
            Math.abs(
              observerAltitudeKm(onEllipsoid(lat, lon), WGS84, GROUND_KM),
            ),
          ).toBeLessThan(1e-6);
        },
      ),
    );
  });
});
