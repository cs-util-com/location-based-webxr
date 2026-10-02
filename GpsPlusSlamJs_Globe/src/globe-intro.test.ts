/**
 * The globe's fly-in (round-5 plan 2026-10-01-0945 §3.1, DEC-GL5-1..3).
 *
 * Why this test matters: the intro starts far out (DEC-GL5-1), turns from
 * the sun side towards the user by at most 90 degrees (DEC-GL5-3) and ends,
 * whatever the variant, at ONE pose and field of view (DEC-GL5-2: 50
 * degrees), because the lab then hands the camera and `fovY` over at that
 * pose: a variant that ended a little elsewhere would jump. The variants
 * differ only in how distance and field of view trade on the way.
 */
import { describe, expect, it } from "vitest";

import {
  GLOBE_INTRO,
  INTRO_VARIANTS,
  blendTarget,
  flyInStart,
  introCameraPose,
  introStartDirection,
  spinDirection,
  type Vec3,
} from "./globe-intro.js";

const DEG = Math.PI / 180;
const unit = (v: Vec3): Vec3 => {
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
};
/** The angle between two vectors, by atan2 (acos loses ~1e-6 degrees near 0). */
const angleDeg = (a: Vec3, b: Vec3): number => {
  const cross = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return (
    Math.atan2(Math.hypot(cross[0] ?? 0, cross[1] ?? 0, cross[2] ?? 0), d) / DEG
  );
};
const fromLatLng = (lat: number, lng: number): Vec3 => [
  Math.cos(lat * DEG) * Math.cos(lng * DEG),
  Math.cos(lat * DEG) * Math.sin(lng * DEG),
  Math.sin(lat * DEG),
];

describe("GLOBE_INTRO", () => {
  it("holds the decided values", () => {
    expect(GLOBE_INTRO.maxKm).toBe(50_000);
    expect(GLOBE_INTRO.endFovDeg).toBe(50);
    expect(GLOBE_INTRO.turnCapDeg).toBe(90);
    expect(INTRO_VARIANTS).toEqual(["distance", "narrow", "fov", "dolly"]);
  });
});

describe("introStartDirection", () => {
  it("starts on the sun when the user is within the cap of it", () => {
    const target = fromLatLng(50, 7);
    const sun = fromLatLng(10, 40);
    const start = introStartDirection(target, sun, 90);
    expect(angleDeg(start, sun)).toBeLessThan(1e-9);
  });

  it("starts at most the cap away from the user, towards the sun", () => {
    // The sun on the far side: the user is in the night.
    const target = fromLatLng(0, 0);
    const sun = fromLatLng(0, 170);
    const start = introStartDirection(target, sun, 90);
    expect(angleDeg(start, target)).toBeCloseTo(90, 9);
    expect(angleDeg(start, sun)).toBeCloseTo(80, 9);
  });

  it("refuses a zero vector or a bad cap", () => {
    expect(() => introStartDirection([0, 0, 0], [1, 0, 0], 90)).toThrow(
      RangeError,
    );
    expect(() => introStartDirection([1, 0, 0], [1, 0, 0], -1)).toThrow(
      RangeError,
    );
    expect(() => introStartDirection([1, 0, 0], [1, 0, 0], Number.NaN)).toThrow(
      RangeError,
    );
  });
});

describe("introCameraPose", () => {
  const target = fromLatLng(50.94, 6.96);
  const start = introStartDirection(target, fromLatLng(-5, -60), 90);
  const base = { start, target, startKm: 50_000, endKm: 16_500, endFovDeg: 50 };

  it.each(INTRO_VARIANTS)(
    "%s ends exactly at the target, the end distance and the end field of view",
    (variant) => {
      const end = introCameraPose(1, { ...base, variant });
      expect(angleDeg(end.direction, target)).toBeLessThan(1e-9);
      expect(end.distanceKm).toBeCloseTo(16_500, 9);
      expect(end.fovDeg).toBeCloseTo(50, 9);
    },
  );

  it("starts at the start: far out, on the sun side", () => {
    for (const variant of INTRO_VARIANTS) {
      const s = introCameraPose(0, { ...base, variant });
      expect(angleDeg(s.direction, start), variant).toBeLessThan(1e-9);
      expect(s.distanceKm, variant).toBeCloseTo(50_000, 9);
    }
  });

  it("gives each variant its own field of view on the way", () => {
    const at = (variant: (typeof INTRO_VARIANTS)[number], t: number) =>
      introCameraPose(t, { ...base, variant });
    expect(at("distance", 0).fovDeg).toBe(50);
    expect(at("narrow", 0).fovDeg).toBe(GLOBE_INTRO.wideFovDeg);
    expect(at("fov", 0).fovDeg).toBe(GLOBE_INTRO.wideFovDeg);
    expect(at("dolly", 0).fovDeg).toBe(GLOBE_INTRO.dollyStartFovDeg);
    // The fov variant holds the start distance while the FOV narrows.
    expect(at("fov", GLOBE_INTRO.fovPhase * 0.9).distanceKm).toBeCloseTo(
      50_000,
      9,
    );
    expect(at("distance", 0.5).distanceKm).toBeLessThan(50_000);
  });

  it("moves monotonically in distance and field of view", () => {
    for (const variant of INTRO_VARIANTS) {
      let previous = introCameraPose(0, { ...base, variant });
      for (let i = 1; i <= 100; i++) {
        const p = introCameraPose(i / 100, { ...base, variant });
        expect(p.distanceKm, variant).toBeLessThanOrEqual(
          previous.distanceKm + 1e-9,
        );
        expect(Math.abs(p.fovDeg - 50), variant).toBeLessThanOrEqual(
          Math.abs(previous.fovDeg - 50) + 1e-9,
        );
        previous = p;
      }
    }
  });

  it("clamps t outside 0-1 and refuses bad input", () => {
    const before = introCameraPose(-1, { ...base, variant: "distance" });
    expect(before.distanceKm).toBeCloseTo(50_000, 9);
    const after = introCameraPose(2, { ...base, variant: "distance" });
    expect(after.distanceKm).toBeCloseTo(16_500, 9);
    expect(() =>
      introCameraPose(0.5, { ...base, variant: "vertigo" as never }),
    ).toThrow(RangeError);
    expect(() =>
      introCameraPose(0.5, { ...base, variant: "distance", endKm: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      introCameraPose(Number.NaN, { ...base, variant: "distance" }),
    ).toThrow(RangeError);
    expect(() =>
      introCameraPose(0.5, { ...base, variant: "distance", endFovDeg: 180 }),
    ).toThrow(RangeError);
  });
});

describe("blendTarget", () => {
  it("moves from the old target to the new one over the blend, eased", () => {
    const a = fromLatLng(40.77, -73.98);
    const b = fromLatLng(50.94, 6.96);
    expect(angleDeg(blendTarget(a, b, 0, 1500), a)).toBeLessThan(1e-9);
    expect(angleDeg(blendTarget(a, b, 1500, 1500), b)).toBeLessThan(1e-9);
    expect(angleDeg(blendTarget(a, b, 9999, 1500), b)).toBeLessThan(1e-9);
    const half = blendTarget(a, b, 750, 1500);
    expect(angleDeg(half, a)).toBeCloseTo(angleDeg(a, b) / 2, 6);
    expect(Math.hypot(...half)).toBeCloseTo(1, 12);
    expect(unit(half)).toEqual(half.map((v) => v / Math.hypot(...half)));
  });
});

// Why (review 2026-10-01-2124 Major 2): the sun-side start and the 90
// degree cap only ever applied to a target known on the very first frame;
// a granted GPS fix, arriving seconds later, started from wherever the
// spin was. Now the spin holds on the sub-solar side, and the fly-in's
// start is computed from the target when it arrives, blending there from
// the spin's direction, so a fix gets the same start as an `at=` link.
describe("spinDirection", () => {
  it("starts at the sub-solar point and turns about the polar axis", () => {
    const sun = fromLatLng(10, 40);
    expect(angleDeg(spinDirection(sun, 0, -3), sun)).toBeLessThan(1e-9);
    const later = spinDirection(sun, 2000, -3);
    // 6 degrees of longitude west, the latitude kept.
    expect(later[2]).toBeCloseTo(unit(sun)[2], 12);
    expect(angleDeg(later, fromLatLng(10, 34))).toBeLessThan(1e-9);
  });

  it("refuses a zero sun or a time or rate that is not finite", () => {
    expect(() => spinDirection([0, 0, 0], 0, -3)).toThrow(RangeError);
    expect(() => spinDirection([1, 0, 0], Number.NaN, -3)).toThrow(RangeError);
    expect(() => spinDirection([1, 0, 0], 0, Infinity)).toThrow(RangeError);
  });
});

describe("flyInStart", () => {
  const sun = fromLatLng(0, 180);
  const night = fromLatLng(50.94, 6.96);
  const spin = spinDirection(sun, 3000, -3);

  it("begins at the spin and ends at the capped sun-side start", () => {
    const start = flyInStart({
      spin,
      target: night,
      sun,
      capDeg: 90,
      sinceArrivalMs: 0,
      blendMs: 1500,
    });
    expect(angleDeg(start, spin)).toBeLessThan(1e-9);
    const settled = flyInStart({
      spin,
      target: night,
      sun,
      capDeg: 90,
      sinceArrivalMs: 1500,
      blendMs: 1500,
    });
    expect(angleDeg(settled, introStartDirection(night, sun, 90))).toBeLessThan(
      1e-9,
    );
    // A night-side fix: at most the cap from it, towards the sun.
    expect(angleDeg(settled, night)).toBeCloseTo(90, 9);
    expect(angleDeg(settled, sun)).toBeLessThan(angleDeg(night, sun));
  });

  it("moves without a jump in between, and starts at once without a blend", () => {
    let prev = spin;
    for (let ms = 50; ms <= 1500; ms += 50) {
      const d = flyInStart({
        spin,
        target: night,
        sun,
        capDeg: 90,
        sinceArrivalMs: ms,
        blendMs: 1500,
      });
      expect(angleDeg(d, prev)).toBeLessThan(10);
      prev = d;
    }
    const now = flyInStart({
      spin,
      target: night,
      sun,
      capDeg: 90,
      sinceArrivalMs: 0,
      blendMs: 0,
    });
    expect(angleDeg(now, introStartDirection(night, sun, 90))).toBeLessThan(
      1e-9,
    );
  });

  it("refuses a negative time or blend", () => {
    const ok = {
      spin,
      target: night,
      sun,
      capDeg: 90,
      sinceArrivalMs: 0,
      blendMs: 1500,
    };
    expect(() => flyInStart({ ...ok, sinceArrivalMs: -1 })).toThrow(RangeError);
    expect(() => flyInStart({ ...ok, blendMs: Number.NaN })).toThrow(
      RangeError,
    );
  });
});

// Why (r764's Globe gate, 2026-10-02): fast-check found directions so
// close to parallel (or antipodal) that the perpendicular the great-circle
// interpolation builds rounded to the zero vector and threw "a
// perpendicular must be a non-zero finite vector": in the lab that would
// abort the intro. Found by a search over near-parallel pairs; earlier
// runs passed by seed luck. The interpolation must take ANY perpendicular
// for opposite directions and return the start for equal ones.
describe("the great-circle interpolation at degenerate pairs", () => {
  // A pair the search found (both normalised again on entry, as every
  // public function does): 3e-16 apart.
  const a: Vec3 = [
    -0.8933070834511898, 0.12975012013101625, 0.4303107725608504,
  ];
  const nearA: Vec3 = [
    -0.8933070834511901, 0.12975012013101628, 0.4303107725608505,
  ];
  const nearOpposite: Vec3 = [-nearA[0], -nearA[1], -nearA[2]];
  const opposite: Vec3 = [-a[0], -a[1], -a[2]];
  const finiteUnit = (v: Vec3) => {
    expect(v.every((c) => Number.isFinite(c))).toBe(true);
    expect(Math.hypot(...v)).toBeCloseTo(1, 12);
  };

  it("blends between equal and nearly equal directions without throwing", () => {
    for (const b of [a, nearA]) {
      const d = blendTarget(a, b, 750, 1500);
      finiteUnit(d);
      expect(angleDeg(d, a)).toBeLessThan(1e-6);
    }
  });

  it("blends between opposite and nearly opposite directions through a perpendicular", () => {
    for (const b of [opposite, nearOpposite]) {
      const d = blendTarget(a, b, 750, 1500);
      finiteUnit(d);
      // Half-way along any great circle between opposites: 90 degrees.
      expect(angleDeg(d, a)).toBeCloseTo(90, 6);
    }
  });

  it("flies the fly-in between nearly equal and nearly opposite starts and targets", () => {
    for (const target of [nearA, nearOpposite]) {
      const p = introCameraPose(0.5, {
        variant: "distance",
        start: a,
        target,
        startKm: 50_000,
        endKm: 16_000,
        endFovDeg: 50,
      });
      finiteUnit(p.direction);
      // Half-way (eased 0.5): on the start for a nearly equal target,
      // 90 degrees from it for a nearly opposite one.
      expect(angleDeg(p.direction, a)).toBeCloseTo(
        target === nearA ? 0 : 90,
        6,
      );
    }
  });
});
