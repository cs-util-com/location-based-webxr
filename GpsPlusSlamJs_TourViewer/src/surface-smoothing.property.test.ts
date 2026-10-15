/**
 * Invariants and parameter sweeps of the mesh cursor's smoothing in time
 * (mesh-cursor smoothing plan 2026-10-15-0944).
 *
 * Why these tests matter: the smoother runs every XR frame on whatever the
 * raycast returns, at whatever frame rate the phone manages. A NaN or a
 * non-unit normal would break the ring's pose; a frame-rate dependent
 * factor would make it feel different on every phone; a lag beyond the
 * snap ratio must never survive a frame. The sweeps pin that the verdict
 * behind the defaults holds across the plausible range of each setting,
 * not only at the chosen value (owner rule 2026-09-13).
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Vector3 } from "three";

import { createSurfaceSmoother, smoothingAlpha } from "./surface-smoothing.js";

const coord = fc.double({ min: -50, max: 50, noNaN: true });
const point = fc.tuple(coord, coord, coord);
const direction = fc
  .tuple(
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
  )
  .filter(([x, y, z]) => Math.hypot(x, y, z) > 1e-3);
const dt = fc.oneof(
  fc.double({ min: -1, max: 2, noNaN: true }),
  fc.constantFrom(0, 1 / 120, 1 / 60, 1 / 30, Number.POSITIVE_INFINITY),
);
const tau = fc.double({ min: 0, max: 1, noNaN: true });
const sample = fc.record({
  p: point,
  n: direction,
  dt,
  distance: fc.double({ min: 0, max: 20, noNaN: true }),
});

function surface([x, y, z]: number[], [nx, ny, nz]: number[]) {
  return {
    position: new Vector3(x, y, z),
    normal: new Vector3(nx, ny, nz),
  };
}

describe("surface smoothing invariants (property)", () => {
  it("always gives a finite point and a unit normal", () => {
    fc.assert(
      fc.property(
        tau,
        tau,
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.array(sample, { minLength: 1, maxLength: 30 }),
        (positionTauS, normalTauS, snapRatio, samples) => {
          const s = createSurfaceSmoother({
            positionTauS,
            normalTauS,
            snapRatio,
          });
          for (const { p, n, dt: step, distance } of samples) {
            const out = s.update(surface(p, n), step, distance);
            expect(out).not.toBeNull();
            const { position, normal } = out!;
            expect(position.toArray().every(Number.isFinite)).toBe(true);
            expect(Math.abs(normal.length() - 1)).toBeLessThan(1e-9);
          }
        },
      ),
    );
  });

  it("never moves away from a held target, and never past it", () => {
    fc.assert(
      fc.property(
        point,
        point,
        direction,
        direction,
        fc.array(fc.double({ min: 0, max: 0.2, noNaN: true }), {
          minLength: 1,
          maxLength: 40,
        }),
        (from, to, n0, n1, steps) => {
          const s = createSurfaceSmoother({ snapRatio: 1e6 });
          s.update(surface(from, n0), 1 / 60, 1);
          const target = surface(to, n1);
          const unitTarget = target.normal.clone().normalize();
          let last = s.update(surface(from, n0), 0, 1)!;
          for (const step of steps) {
            const out = s.update(surface(to, n1), step, 1)!;
            const before = last.position.distanceTo(target.position);
            const after = out.position.distanceTo(target.position);
            expect(after).toBeLessThanOrEqual(before + 1e-9);
            expect(out.normal.angleTo(unitTarget)).toBeLessThanOrEqual(
              last.normal.angleTo(unitTarget) + 1e-6,
            );
            last = out;
          }
        },
      ),
    );
  });

  it("is frame-rate independent for a held target", () => {
    // N small steps equal one large one: the same 0.4 s at 30, 60, 90,
    // 120 Hz and at an irregular rate land the ring at the same place.
    fc.assert(
      fc.property(
        point,
        point,
        direction,
        direction,
        fc.constantFrom(12, 24, 36, 48),
        (from, to, n0, n1, frames) => {
          const run = (n: number) => {
            const s = createSurfaceSmoother({ snapRatio: 1e6 });
            let out = s.update(surface(from, n0), 1 / 60, 1);
            for (let i = 0; i < n; i += 1) {
              out = s.update(surface(to, n1), 0.4 / n, 1);
            }
            return out!;
          };
          const coarse = run(frames);
          const fine = run(frames * 2);
          expect(coarse.position.distanceTo(fine.position)).toBeLessThan(1e-7);
          expect(coarse.normal.angleTo(fine.normal)).toBeLessThan(1e-6);
        },
      ),
    );
  });

  it("never keeps a lag beyond the snap ratio", () => {
    fc.assert(
      fc.property(
        fc.array(sample, { minLength: 2, maxLength: 30 }),
        fc.double({ min: 0.05, max: 1, noNaN: true }),
        (samples, snapRatio) => {
          const s = createSurfaceSmoother({ snapRatio });
          let previous: Vector3 | null = null;
          for (const { p, n, dt: step, distance } of samples) {
            const target = surface(p, n);
            const out = s.update(target, step, distance)!;
            const mustSnap =
              previous !== null &&
              previous.distanceTo(target.position) > snapRatio * distance;
            expect(!mustSnap || out.position.equals(target.position)).toBe(
              true,
            );
            previous = out.position.clone();
          }
        },
      ),
    );
  });

  it("smoothingAlpha stays within [0, 1] and composes over split steps", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1e-3, max: 2, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (t, a, b) => {
          const whole = smoothingAlpha(t, a + b);
          const split =
            1 - (1 - smoothingAlpha(t, a)) * (1 - smoothingAlpha(t, b));
          expect(whole).toBeGreaterThanOrEqual(0);
          expect(whole).toBeLessThanOrEqual(1);
          expect(Math.abs(whole - split)).toBeLessThan(1e-12);
        },
      ),
    );
  });
});

/** Deterministic noise in [-1, 1] (a fixed LCG: sweeps must not flake). */
function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}

/** The ring's tremble over 3 s at 60 Hz on a still surface with 1 cm of
 *  noise per frame, as a share of the input's (1 = no calming). */
function trembleRatio(positionTauS: number): number {
  const s = createSurfaceSmoother({ positionTauS, snapRatio: 1e6 });
  const rand = noise(7);
  let inSq = 0;
  let outSq = 0;
  const frames = 180;
  for (let i = 0; i < frames; i += 1) {
    const x = 0.01 * rand();
    const out = s.update(
      { position: new Vector3(x, 0, 0), normal: new Vector3(0, 1, 0) },
      1 / 60,
      2,
    )!;
    if (i >= 30) {
      inSq += x * x;
      outSq += out.position.x ** 2;
    }
  }
  return Math.sqrt(outSq / inSq);
}

/** Seconds until the ring is within 1 cm of a 20 cm step, at 60 Hz. */
function settleS(positionTauS: number): number {
  const s = createSurfaceSmoother({ positionTauS, snapRatio: 1e6 });
  const up = new Vector3(0, 1, 0);
  s.update({ position: new Vector3(0, 0, 0), normal: up }, 1 / 60, 2);
  for (let i = 1; i <= 600; i += 1) {
    const out = s.update(
      { position: new Vector3(0.2, 0, 0), normal: up },
      1 / 60,
      2,
    )!;
    if (0.2 - out.position.x < 0.01) return i / 60;
  }
  return Number.POSITIVE_INFINITY;
}

describe("surface smoothing sweeps (owner rule 2026-09-13)", () => {
  const taus = [0.03, 0.05, 0.08, 0.1, 0.15, 0.2, 0.3];

  it("trades tremble for settle time monotonically across the time constants", () => {
    // The verdict: a longer time constant always calms more and always
    // settles later - no value is better at both, so the default is the
    // trade the owner asked for ("a little bit more"), and a reversal of
    // this curve would mean the smoother is not what its sidecar says.
    const rows = taus.map((t) => ({
      t,
      tremble: trembleRatio(t),
      settle: settleS(t),
    }));
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i]!.tremble).toBeLessThan(rows[i - 1]!.tremble);
      expect(rows[i]!.settle).toBeGreaterThanOrEqual(rows[i - 1]!.settle);
    }
    // White noise through an exponential step: sqrt(a / (2 - a)).
    for (const { t, tremble } of rows) {
      const a = smoothingAlpha(t, 1 / 60);
      expect(tremble / Math.sqrt(a / (2 - a))).toBeGreaterThan(0.75);
      expect(tremble / Math.sqrt(a / (2 - a))).toBeLessThan(1.25);
    }
    // Settle to 1 cm of 20 cm is tau x ln(20), within a frame.
    for (const { t, settle } of rows) {
      expect(Math.abs(settle - t * Math.log(20))).toBeLessThanOrEqual(1 / 60);
    }
  });

  it("the default position time constant calms the tremble to under a third and settles within a third of a second", () => {
    expect(trembleRatio(0.1)).toBeLessThan(1 / 3);
    expect(settleS(0.1)).toBeLessThan(1 / 3);
  });

  it("the snap separates a pan from a change of surface across the ratio's range", () => {
    // A steady pan along a floor 2 m away at 1 m/s lags v x tau; a jump to
    // a surface 1.5 m behind lags 1.5 m. For every ratio from 0.1 to 0.6 at
    // the default time constant, the pan glides and the jump snaps - so the
    // default (0.3) is not balanced on a knife edge.
    for (const ratio of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) {
      const pan = createSurfaceSmoother({ snapRatio: ratio });
      let out: ReturnType<typeof pan.update> = null;
      for (let i = 0; i <= 60; i += 1) {
        out = pan.update(
          {
            position: new Vector3(i / 60, 0, -2),
            normal: new Vector3(0, 1, 0),
          },
          1 / 60,
          2,
        );
      }
      const lag = 1 - out!.position.x;
      expect(lag, `ratio ${String(ratio)}`).toBeGreaterThan(0.05);

      const jump = createSurfaceSmoother({ snapRatio: ratio });
      jump.update(
        { position: new Vector3(0, 0.8, -1), normal: new Vector3(0, 1, 0) },
        1 / 60,
        1,
      );
      const landed = jump.update(
        { position: new Vector3(0, 0, -2.5), normal: new Vector3(0, 1, 0) },
        1 / 60,
        2.5,
      )!;
      expect(landed.position.z, `ratio ${String(ratio)}`).toBe(-2.5);
    }
  });
});
