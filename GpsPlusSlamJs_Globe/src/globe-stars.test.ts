/**
 * Why this test matters: the stars are PROCEDURAL (owner decision
 * 2026-09-27, round-2 Q2: no catalogue with a clear licence was found), so
 * nothing but these properties makes them look like a sky:
 * - the same seed gives the same sky on every load (a pinned link must
 *   reproduce the scene, and a pixel probe must not see a new sky);
 * - the counts rise about 10^(0.5 m) up to the magnitude limit, a few
 *   thousand at 6.5, which is what makes most stars faint and few bright;
 * - directions are uniform on the sphere (no clumping at the poles, the
 *   classic mistake of sampling latitude uniformly);
 * - they turn with Greenwich sidereal time like real stars, checked against
 *   the published reference values, so the day side's sun and the stars
 *   agree (the lab smoke checks the sun's right ascension against it).
 */

import fc from "fast-check";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  GALACTIC_CENTRE,
  GALACTIC_NORTH_POLE,
  GLOBE_STARS,
  celestialToEcefQuaternion,
  fromSnorm16,
  generateStarField,
  greenwichSiderealAngleRad,
  octahedralDecode,
  octahedralEncode,
  packStarField,
  unpackMagnitude,
} from "./globe-stars.js";

const DEG = Math.PI / 180;

describe("generateStarField", () => {
  it("is the same sky for the same seed, and another for another seed", () => {
    const a = generateStarField({ seed: 7, magLimit: 6.5 });
    const b = generateStarField({ seed: 7, magLimit: 6.5 });
    const c = generateStarField({ seed: 8, magLimit: 6.5 });
    expect(a.count).toBe(b.count);
    expect(Array.from(a.directions)).toEqual(Array.from(b.directions));
    expect(Array.from(a.magnitudes)).toEqual(Array.from(b.magnitudes));
    expect(Array.from(a.directions.slice(0, 30))).not.toEqual(
      Array.from(c.directions.slice(0, 30)),
    );
  });

  it("has a few thousand stars to 6.5, counts rising about 10^(0.5 m)", () => {
    const counts = [5.5, 6.5, 7.5].map(
      (magLimit) => generateStarField({ seed: 1, magLimit }).count,
    );
    expect(counts[1]).toBe(GLOBE_STARS.countAt6_5);
    expect(counts[1]).toBeGreaterThanOrEqual(2000);
    expect(counts[1]).toBeLessThanOrEqual(9000);
    // One magnitude: x10^0.5 = x3.16, within rounding.
    expect(counts[1] / counts[0]).toBeCloseTo(Math.sqrt(10), 1);
    expect(counts[2] / counts[1]).toBeCloseTo(Math.sqrt(10), 1);
    // Within one field, the cumulative count follows the same law.
    const field = generateStarField({ seed: 3, magLimit: 6.5 });
    const brighterThan = (m: number) =>
      field.magnitudes.filter((x) => x < m).length;
    const ratio = brighterThan(6.5) / brighterThan(4.5);
    expect(ratio).toBeGreaterThan(10 * 0.8);
    expect(ratio).toBeLessThan(10 * 1.25);
    for (const m of field.magnitudes) {
      expect(m).toBeGreaterThanOrEqual(GLOBE_STARS.brightestMag);
      expect(m).toBeLessThanOrEqual(6.5);
    }
  });

  // Why (round-4 plan 2026-09-28-2105 DEC-GL4-2): the owner asked for more
  // than the old 7.5 limit. The field is generated to magnitude 9 and the
  // counts follow the same law all the way: about 89,000 stars.
  it("reaches magnitude 9 on the same count law (DEC-GL4-2)", () => {
    expect(GLOBE_STARS.maxMagLimit).toBe(9);
    const at = (magLimit: number) =>
      generateStarField({ seed: 1, magLimit }).count;
    expect(at(9)).toBe(Math.round(GLOBE_STARS.countAt6_5 * 10 ** 1.25));
    expect(at(9) / at(8)).toBeCloseTo(Math.sqrt(10), 1);
    const field = generateStarField({ seed: 2, magLimit: 9 });
    expect(Math.max(...field.magnitudes)).toBeLessThanOrEqual(9);
    expect(Math.min(...field.magnitudes)).toBeGreaterThanOrEqual(
      GLOBE_STARS.brightestMag,
    );
  });

  it("scatters unit directions uniformly over the sphere", () => {
    const { count, directions } = generateStarField({
      seed: 11,
      magLimit: 6.5,
    });
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let polar = 0;
    for (let i = 0; i < count; i++) {
      const [x, y, z] = [
        directions[3 * i],
        directions[3 * i + 1],
        directions[3 * i + 2],
      ];
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
      sx += x;
      sy += y;
      sz += z;
      // Uniform on the sphere: |z| > 0.5 is half the area (a latitude
      // sampled uniformly would give a third).
      if (Math.abs(z) > 0.5) polar += 1;
    }
    // The mean of n uniform unit vectors has a spread of about 1/sqrt(3n).
    const bound = 4 / Math.sqrt(3 * count);
    expect(Math.abs(sx / count)).toBeLessThan(bound);
    expect(Math.abs(sy / count)).toBeLessThan(bound);
    expect(Math.abs(sz / count)).toBeLessThan(bound);
    expect(polar / count).toBeGreaterThan(0.46);
    expect(polar / count).toBeLessThan(0.54);
  });

  it("gives each star a slight colour, near white", () => {
    const { count, colors } = generateStarField({ seed: 5, magLimit: 6.5 });
    for (let i = 0; i < count * 3; i++) {
      expect(colors[i]).toBeGreaterThanOrEqual(0.6);
      expect(colors[i]).toBeLessThanOrEqual(1);
    }
    // Some bluish (blue channel highest) and some reddish (red highest).
    let blue = 0;
    let red = 0;
    for (let i = 0; i < count; i++) {
      if (colors[3 * i + 2] > colors[3 * i]) blue += 1;
      if (colors[3 * i] > colors[3 * i + 2]) red += 1;
    }
    expect(blue).toBeGreaterThan(count * 0.1);
    expect(red).toBeGreaterThan(count * 0.1);
  });

  it("refuses a non-integer seed or a magnitude limit out of range", () => {
    for (const bad of [
      { seed: 1.5, magLimit: 6.5 },
      { seed: 1, magLimit: Number.NaN },
      { seed: 1, magLimit: 9.5 },
      { seed: 1, magLimit: 0 },
    ]) {
      expect(() => generateStarField(bad)).toThrow(RangeError);
    }
  });
});

/**
 * Why (round-4 plan DEC-GL4-2): at magnitude 9 the field is about 89,000
 * stars, 2.5 MB as float32 (28 bytes a star). Packed to 6 bytes a star it
 * is 0.53 MB, but only if the packing keeps every star where it was, as
 * bright as it was, in the colour it had, and in the order the draw range
 * relies on (brightest first).
 */
describe("packStarField", () => {
  const DEG_ = Math.PI / 180;
  const unit = fc
    .tuple(
      fc.double({ min: -1, max: 1, noNaN: true }),
      fc.double({ min: -1, max: 1, noNaN: true }),
      fc.double({ min: -1, max: 1, noNaN: true }),
    )
    .filter(([x, y, z]) => Math.hypot(x, y, z) > 1e-3)
    .map(([x, y, z]) => {
      const n = Math.hypot(x, y, z);
      return [x / n, y / n, z / n] as const;
    });

  it("folds any direction onto the square and back, 16-bit, within 0.01°", () => {
    fc.assert(
      fc.property(unit, ([x, y, z]) => {
        const [u, v] = octahedralEncode(x, y, z);
        expect(Math.abs(u)).toBeLessThanOrEqual(1);
        expect(Math.abs(v)).toBeLessThanOrEqual(1);
        const q = (a: number) => fromSnorm16(Math.round(a * 32767));
        const [a, b, c] = octahedralDecode(q(u), q(v));
        const dot = Math.min(1, a * x + b * y + c * z);
        expect(Math.acos(dot) / DEG_).toBeLessThan(0.01);
      }),
      { examples: [[[0, 0, -1]], [[0, 0, 1]], [[1, 0, 0]], [[0, -1, 0]]] },
    );
  });

  it("keeps each star's direction, magnitude and tint, brightest first, in 6 bytes", () => {
    const field = generateStarField({ seed: 9, magLimit: 7 });
    const packed = packStarField(field);
    /** An array element that must exist (the arrays are sized by count). */
    const at = (a: ArrayLike<number>, i: number): number => {
      const v = a[i];
      if (v === undefined) throw new Error(`no element ${i}`);
      return v;
    };
    expect(packed.count).toBe(field.count);
    expect(packed.octahedral.byteLength + packed.magTint.byteLength).toBe(
      6 * field.count,
    );
    for (let i = 1; i < packed.count; i++) {
      expect(packed.magnitudes[i]).toBeGreaterThanOrEqual(
        at(packed.magnitudes, i - 1),
      );
    }
    // Half a byte step of magnitude: (9 + 1.5) / 255 / 2.
    const halfStep = (GLOBE_STARS.maxMagLimit - GLOBE_STARS.brightestMag) / 510;
    const sorted = [...field.magnitudes].sort((a, b) => a - b);
    packed.magnitudes.forEach((m, i) => {
      expect(Math.abs(m - at(sorted, i))).toBeLessThanOrEqual(halfStep + 1e-6);
      // Stored as float32: equal to the decode within its precision.
      expect(unpackMagnitude(at(packed.magTint, 2 * i))).toBeCloseTo(m, 5);
    });
    // The brightest star is first after the sort, and decodes to where the
    // field put it.
    const src = [...field.magnitudes].indexOf(at(sorted, 0));
    const [x, y, z] = octahedralDecode(
      fromSnorm16(at(packed.octahedral, 0)),
      fromSnorm16(at(packed.octahedral, 1)),
    );
    const d = field.directions;
    const dot =
      x * at(d, 3 * src) + y * at(d, 3 * src + 1) + z * at(d, 3 * src + 2);
    expect(Math.acos(Math.min(1, dot)) / DEG_).toBeLessThan(0.01);
    // The tint: red minus blue is 0.6 t; bytes over [-0.5, 0.5].
    const t = (at(field.colors, 3 * src) - at(field.colors, 3 * src + 2)) / 0.6;
    expect(Math.abs(at(packed.magTint, 1) / 255 - 0.5 - t)).toBeLessThanOrEqual(
      0.5 / 255 + 1e-6,
    );
  });
});

describe("the Milky Way's plane", () => {
  it("is tilted about 62.9° to the celestial equator, its centre in the plane", () => {
    const pole = new THREE.Vector3(...GALACTIC_NORTH_POLE);
    expect(pole.length()).toBeCloseTo(1, 12);
    expect(Math.acos(pole.z) / DEG).toBeCloseTo(62.87, 1);
    // The centre lies in the plane (perpendicular to its pole).
    const centre = new THREE.Vector3(...GALACTIC_CENTRE);
    expect(Math.abs(centre.dot(pole))).toBeLessThan(1e-4);
    // The plane crosses the celestial equator northwards at RA 282.86°.
    const node = new THREE.Vector3(0, 0, 1).cross(pole).normalize();
    const ra = (((Math.atan2(node.y, node.x) / DEG) % 360) + 360) % 360;
    expect(ra).toBeCloseTo(282.86, 1);
  });
});

describe("greenwichSiderealAngleRad", () => {
  // Reference values: the astronomical almanac's example for 1987 April 10
  // (GMST 13h10m46.3668s at 0h UT; 8h34m57.0896s at 19:21:00 UT).
  it("matches the published reference values", () => {
    const at = (iso: string) => greenwichSiderealAngleRad(Date.parse(iso));
    const hms = (h: number, m: number, s: number) =>
      ((h + m / 60 + s / 3600) * 15 * DEG) % (2 * Math.PI);
    expect(at("1987-04-10T00:00:00Z")).toBeCloseTo(hms(13, 10, 46.3668), 7);
    expect(at("1987-04-10T19:21:00Z")).toBeCloseTo(hms(8, 34, 57.0896), 7);
  });

  it("stays in [0, 2π) and turns once per sidereal day", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4.1e12 }), (ms) => {
        const a = greenwichSiderealAngleRad(ms);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThan(2 * Math.PI);
        const sidereal = 86_164_090.5;
        const b = greenwichSiderealAngleRad(ms + sidereal);
        const d = Math.abs(a - b);
        expect(Math.min(d, 2 * Math.PI - d)).toBeLessThan(1e-6);
      }),
    );
  });

  it("refuses a non-finite instant", () => {
    expect(() => greenwichSiderealAngleRad(Number.NaN)).toThrow(RangeError);
  });
});

describe("celestialToEcefQuaternion", () => {
  it("puts right ascension equal to the sidereal angle on the Greenwich meridian", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        fc.double({ min: -1.5, max: 1.5, noNaN: true }),
        (theta, dec) => {
          const q = celestialToEcefQuaternion(theta);
          // A star at RA = theta, on the Greenwich meridian (ECEF lon 0).
          const star = new THREE.Vector3(
            Math.cos(dec) * Math.cos(theta),
            Math.cos(dec) * Math.sin(theta),
            Math.sin(dec),
          ).applyQuaternion(q);
          expect(star.y).toBeCloseTo(0, 9);
          expect(star.x).toBeCloseTo(Math.cos(dec), 9);
          expect(star.z).toBeCloseTo(Math.sin(dec), 9);
        },
      ),
    );
  });
});
