/**
 * Why this test matters: the space dust (round-2 plan 2026-10-07-2350
 * DEC-FR2-7, the owner: "particles, so you feel how fast the camera is
 * coming in") must move on screen exactly as the camera moves, never jump,
 * stream outward as the camera descends, and be gone before the sky.
 */

import { describe, expect, it } from "vitest";

import {
  GLOBE_SPACE_DUST,
  createDustField,
  dustFade,
  dustShare,
  wrapDust,
} from "./globe-space-dust.js";
import { GLOBE_CLIP } from "./globe-camera.js";

const KM = 1_000;
const CAM = [7_000 * KM, 0, 0] as const;

/** The largest offset of any point from the camera on any axis, m. */
function reach(points: Float32Array, camera: readonly number[]): number {
  let worst = 0;
  for (let i = 0; i < points.length; i++) {
    worst = Math.max(worst, Math.abs((points[i] ?? 0) - (camera[i % 3] ?? 0)));
  }
  return worst;
}

describe("the space dust", () => {
  it("fills the box around the camera, repeatably", () => {
    const a = createDustField(CAM, 1_000 * KM, 300, 7);
    const b = createDustField(CAM, 1_000 * KM, 300, 7);
    expect(a).toEqual(b);
    expect(a.length).toBe(900);
    expect(reach(a, CAM)).toBeLessThanOrEqual(
      GLOBE_SPACE_DUST.boxShare * 1_000 * KM,
    );
  });

  // The camera clips everything nearer than a share of its altitude
  // (GLOBE_CLIP.nearFraction): a box no deeper than that would be drawn
  // empty. Most of the box must lie beyond the near plane.
  it("reaches well past the camera's near plane", () => {
    expect(GLOBE_SPACE_DUST.boxShare).toBeGreaterThanOrEqual(
      3 * GLOBE_CLIP.nearFraction,
    );
  });

  // The points are still in the world: a camera that does not move leaves
  // them where they are, so they never jitter.
  it("leaves the points alone while the camera holds still", () => {
    const points = createDustField(CAM, 1_000 * KM, 300);
    const before = Float32Array.from(points);
    wrapDust(points, CAM, 1_000 * KM);
    expect(points).toEqual(before);
  });

  it("wraps a point that left the box to the opposite face, and only those", () => {
    const half = GLOBE_SPACE_DUST.boxShare * 1_000 * KM;
    const points = new Float32Array([
      CAM[0] + half * 1.2,
      0,
      0, // out past +x
      CAM[0] - half * 0.5,
      half * 0.1,
      0, // inside
    ]);
    wrapDust(points, CAM, 1_000 * KM);
    expect((points[0] ?? 0) - CAM[0]).toBeCloseTo(-half * 0.8, -1);
    expect((points[3] ?? 0) - CAM[0]).toBeCloseTo(-half * 0.5, -1);
    expect(reach(points, CAM)).toBeLessThanOrEqual(half);
  });

  // As the camera descends the box shrinks, so the points it keeps are the
  // ones nearer the view: on screen they stream outward.
  it("keeps every point in the shrinking box as the camera descends", () => {
    const points = createDustField(CAM, 10_000 * KM, 1_000);
    for (let h = 10_000 * KM; h > 300 * KM; h *= 0.9) {
      wrapDust(points, CAM, h);
      expect(reach(points, CAM)).toBeLessThanOrEqual(
        GLOBE_SPACE_DUST.boxShare * h * (1 + 1e-6),
      );
    }
  });

  it("ignores a camera or an altitude that is not a number", () => {
    const points = createDustField(CAM, 1_000 * KM, 30);
    const before = Float32Array.from(points);
    wrapDust(points, [Number.NaN, 0, 0], 1_000 * KM);
    wrapDust(points, CAM, 0);
    expect(points).toEqual(before);
    expect(() => createDustField(CAM, 1_000 * KM, 0)).toThrow(RangeError);
    expect(() => createDustField(CAM, -1, 10)).toThrow(RangeError);
  });

  // WHY (R4/R5 milestone review): a point that leaves the box comes back
  // at the opposite face, often towards the Earth and in view; at full
  // brightness it popped in (about 3 % of the points a frame on a fast
  // descent at 10 Hz). Each point fades to nothing at the box's faces, so
  // a wrap happens where it cannot be seen.
  it("fades each point out at the box's faces, so a wrap never pops", () => {
    const half = GLOBE_SPACE_DUST.boxShare * 1_000 * KM;
    const points = new Float32Array([
      CAM[0],
      0,
      0, // the centre
      CAM[0] + half * 0.999,
      0,
      0, // at a face
      CAM[0],
      half * 0.5,
      -half * 0.5, // halfway
      CAM[0] - half * 0.999,
      half * 0.999,
      0, // at an edge
    ]);
    const fade = new Float32Array(4);
    dustFade(points, CAM, 1_000 * KM, fade);
    expect(fade[0]).toBe(1);
    expect(fade[1]).toBeLessThan(0.01);
    expect(fade[2]).toBe(1);
    expect(fade[3]).toBeLessThan(0.01);
    // Through a whole descent at 5 % a frame (a dive is about 0.11 e-folds a
    // second: 1.1 % at 10 Hz, 2.3 % at 5 Hz; the 0.25 band of the first
    // version popped from about 3.4 %) no point that wraps is visible on either side of its wrap:
    // as last drawn (the previous frame's box) and as drawn next.
    const field = createDustField(CAM, 10_000 * KM, 2_000);
    let shown = new Float32Array(2_000);
    dustFade(field, CAM, 10_000 * KM, shown);
    const next = new Float32Array(2_000);
    const popped: string[] = [];
    let wraps = 0;
    for (let h = 10_000 * KM * 0.95; h > 300 * KM; h *= 0.95) {
      const old = Float32Array.from(field);
      wrapDust(field, CAM, h);
      dustFade(field, CAM, h, next);
      for (let i = 0; i < 2_000; i++) {
        const moved = [0, 1, 2].some(
          (k) => Math.abs((field[3 * i + k] ?? 0) - (old[3 * i + k] ?? 0)) > 1,
        );
        if (!moved) continue;
        wraps += 1;
        const was = shown[i] ?? 0;
        const is = next[i] ?? 0;
        if (was >= 0.05 || is >= 0.05) {
          popped.push(
            `${(h / KM).toFixed(0)} km: ${was.toFixed(2)} -> ${is.toFixed(2)}`,
          );
        }
      }
      shown = Float32Array.from(next);
    }
    expect(wraps).toBeGreaterThan(100);
    expect(popped).toEqual([]);
  });

  it("is full high up and gone before the sky", () => {
    expect(dustShare(65_000 * KM)).toBe(1);
    expect(dustShare(GLOBE_SPACE_DUST.fullM)).toBe(1);
    expect(dustShare(GLOBE_SPACE_DUST.goneM)).toBe(0);
    expect(dustShare(50 * KM)).toBe(0);
    expect(dustShare(Number.NaN)).toBe(0);
    let last = 0;
    for (let h = 100 * KM; h < 5_000 * KM; h *= 1.05) {
      expect(dustShare(h)).toBeGreaterThanOrEqual(last);
      last = dustShare(h);
    }
  });
});
