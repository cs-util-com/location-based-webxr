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
  introCameraPose,
  introStartDirection,
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
  it("holds the owner's decisions", () => {
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
