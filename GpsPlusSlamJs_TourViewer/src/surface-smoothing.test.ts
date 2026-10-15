/**
 * The mesh cursor's smoothing in time (mesh-cursor smoothing plan
 * 2026-10-15-0944): the owner's phone test of `?mesh=1` - "it could be a
 * little bit smoother: a little bit more lerping".
 *
 * Why these tests matter: the ring is redrawn every XR frame from a raycast
 * against a mesh of noisy depth, so it trembles; smoothing must calm it
 * without making it glide through the air when the cursor crosses onto a
 * different surface (the snap), and must feel the same at 30, 60 and
 * 120 Hz (time constants, never a per-frame factor). A placed pin goes
 * where the ring is, so a smoothed point that is wrong is a pin that is
 * wrong.
 */
import { describe, expect, it } from "vitest";
import { Vector3 } from "three";

import {
  createSurfaceSmoother,
  DEFAULT_SURFACE_SMOOTHING,
  smoothingAlpha,
} from "./surface-smoothing.js";

const UP = new Vector3(0, 1, 0);

function at(x: number, y: number, z: number, normal = UP) {
  return { position: new Vector3(x, y, z), normal: normal.clone() };
}

describe("smoothingAlpha", () => {
  it("is the exact exponential step of a time constant", () => {
    expect(smoothingAlpha(0.1, 0.1)).toBeCloseTo(1 - Math.exp(-1), 12);
    expect(smoothingAlpha(0.2, 0.05)).toBeCloseTo(1 - Math.exp(-0.25), 12);
  });

  it("does not move on a zero or negative gap, and snaps on an unknown one", () => {
    // A clock that runs backward must not push the ring away from its
    // target (the framework's clampedAlpha guards the same).
    expect(smoothingAlpha(0.1, 0)).toBe(0);
    expect(smoothingAlpha(0.1, -0.5)).toBe(0);
    expect(smoothingAlpha(0.1, Number.POSITIVE_INFINITY)).toBe(1);
    expect(smoothingAlpha(0.1, Number.NaN)).toBe(1);
  });

  it("is a full step for a zero time constant (no smoothing)", () => {
    expect(smoothingAlpha(0, 1 / 60)).toBe(1);
  });
});

describe("createSurfaceSmoother", () => {
  it("puts the first point exactly where the surface is", () => {
    const s = createSurfaceSmoother();
    const out = s.update(at(1, 0, 2), 1 / 60, 2);
    expect(out?.position.toArray()).toEqual([1, 0, 2]);
    expect(out?.normal.toArray()).toEqual([0, 1, 0]);
  });

  it("follows a small move part of the way, then converges", () => {
    const s = createSurfaceSmoother({ positionTauS: 0.1, normalTauS: 0.2 });
    s.update(at(0, 0, 0), 1 / 60, 2);
    const first = s.update(at(0.1, 0, 0), 1 / 60, 2)!;
    const alpha = 1 - Math.exp(-1 / 6);
    expect(first.position.x).toBeCloseTo(0.1 * alpha, 12);
    let out = first;
    for (let i = 0; i < 120; i += 1) out = s.update(at(0.1, 0, 0), 1 / 60, 2)!;
    expect(out.position.distanceTo(new Vector3(0.1, 0, 0))).toBeLessThan(1e-5);
  });

  it("turns the normal toward a tilted surface more slowly than it moves", () => {
    const s = createSurfaceSmoother({ positionTauS: 0.1, normalTauS: 0.2 });
    s.update(at(0, 0, 0), 1 / 60, 2);
    const tilted = new Vector3(Math.sin(0.5), Math.cos(0.5), 0);
    const out = s.update(at(0, 0, 0, tilted), 1 / 60, 2)!;
    const angle = out.normal.angleTo(UP);
    expect(angle).toBeCloseTo(0.5 * (1 - Math.exp(-1 / 12)), 9);
    expect(Math.abs(out.normal.length() - 1)).toBeLessThan(1e-12);
  });

  it("snaps when the ring would glide to a different surface", () => {
    // A table edge at 1 m, the floor behind it at 2.5 m: 1.5 m of lag
    // against 0.3 x 2.5 m - the ring jumps instead of floating there.
    const s = createSurfaceSmoother({ snapRatio: 0.3 });
    s.update(at(0, 0.8, -1), 1 / 60, 1);
    const wall = new Vector3(0, 0, 1);
    const out = s.update(at(0, 0, -2.5, wall), 1 / 60, 2.5)!;
    expect(out.position.toArray()).toEqual([0, 0, -2.5]);
    expect(out.normal.toArray()).toEqual([0, 0, 1]);
  });

  it("does not snap on a lag below the ratio", () => {
    const s = createSurfaceSmoother({ snapRatio: 0.3 });
    s.update(at(0, 0, 0), 1 / 60, 2);
    const out = s.update(at(0.5, 0, 0), 1 / 60, 2)!; // 0.5 < 0.6
    expect(out.position.x).toBeGreaterThan(0);
    expect(out.position.x).toBeLessThan(0.5);
  });

  it("continues from the ring after a short hole, and a long gap catches up by itself", () => {
    const s = createSurfaceSmoother({ positionTauS: 0.1 });
    s.update(at(0, 0, 0), 1 / 60, 2);
    const short = s.update(at(0.2, 0, 0), 2 / 60, 2)!;
    expect(short.position.x).toBeLessThan(0.2 * 0.5);
    const long = s.update(at(0.4, 0, 0), 2, 2)!;
    expect(0.4 - long.position.x).toBeLessThan(1e-6);
  });

  it("starts again after reset()", () => {
    const s = createSurfaceSmoother();
    s.update(at(0, 0, 0), 1 / 60, 2);
    s.reset();
    expect(s.update(at(0.3, 0, 0), 1 / 60, 2)?.position.x).toBe(0.3);
  });

  it("treats a non-finite point or a zero normal as no sample", () => {
    const s = createSurfaceSmoother();
    s.update(at(0, 0, 0), 1 / 60, 2);
    expect(s.update(at(Number.NaN, 0, 0), 1 / 60, 2)).toBeNull();
    expect(s.update(at(0, 0, 0, new Vector3(0, 0, 0)), 1 / 60, 2)).toBeNull();
    // ...and the next good sample is a fresh start, not a glide from a
    // point that was never shown.
    expect(s.update(at(0.3, 0, 0), 1 / 60, 2)?.position.x).toBe(0.3);
  });

  it("snaps when the distance to the surface is unknown", () => {
    const s = createSurfaceSmoother();
    s.update(at(0, 0, 0), 1 / 60, 2);
    expect(s.update(at(0.1, 0, 0), 1 / 60, Number.NaN)?.position.x).toBe(0.1);
  });

  it("hands out copies: changing an output does not move the ring", () => {
    const s = createSurfaceSmoother();
    const out = s.update(at(0, 0, 0), 1 / 60, 2)!;
    out.position.set(9, 9, 9);
    out.normal.set(1, 0, 0);
    const next = s.update(at(0, 0, 0), 1 / 60, 2)!;
    expect(next.position.toArray()).toEqual([0, 0, 0]);
    expect(next.normal.toArray()).toEqual([0, 1, 0]);
  });

  it("refuses a negative or non-finite setting", () => {
    expect(() => createSurfaceSmoother({ positionTauS: -1 })).toThrow(
      RangeError,
    );
    expect(() => createSurfaceSmoother({ normalTauS: Number.NaN })).toThrow(
      RangeError,
    );
    expect(() => createSurfaceSmoother({ snapRatio: -0.1 })).toThrow(
      RangeError,
    );
  });

  it("keeps conservative defaults", () => {
    // Why: the owner asked for "a little bit more" - not a ring that trails
    // the phone. Rotation is smoothed more than position (his words).
    expect(DEFAULT_SURFACE_SMOOTHING).toEqual({
      positionTauS: 0.1,
      normalTauS: 0.2,
      snapRatio: 0.3,
    });
  });
});
