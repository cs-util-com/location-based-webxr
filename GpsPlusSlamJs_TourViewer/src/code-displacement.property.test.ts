/**
 * Properties of the moved-code displacement estimators (authoring plan
 * 2026-09-28-0953 §3.6, D20, M5a).
 *
 * Why these properties matter: the unit tests pick a few poses; a veto
 * keyed on these numbers runs on every code any visitor scans. So, for ANY
 * odometry frame, saved pose, heading error, move and walk:
 * - with exact GPS the rigid fit reads exactly the move at the code - a
 *   heading error never reads as a move (§7j #1);
 * - a constant GPS bias adds exactly itself to both estimates, which is
 *   why no estimator can tell a bias from a move (§3.6, "the ambiguity
 *   that cannot be removed") and why the bound needs a floor;
 * - the residual estimator's heading-error leak is bounded by the radius:
 *   at most 2 sin(theta/2) R;
 * - the order of the fixes never matters (the viewer may read its history
 *   in any order, and the fold is what M5c runs per fix).
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Matrix4, Quaternion, Vector3 } from "three";

import {
  estimateCodeDisplacement,
  pinCode,
  type DisplacementSample,
} from "./code-displacement.js";
import type { NuePose } from "./visit-anchoring.js";

const rad = (d: number): number => (d * Math.PI) / 180;

function pose(n: number, e: number, yawDeg: number): NuePose {
  const h = rad(yawDeg) / 2;
  return { position: [n, 1.5, e], rotation: [0, Math.sin(h), 0, Math.cos(h)] };
}

interface World {
  odomYawDeg: number;
  odomShift: [number, number];
  stored: [number, number, number];
  headingErrDeg: number;
  move: [number, number];
  turnDeg: number;
  walk: [number, number][];
  bias: [number, number];
}

const coord = fc.double({ min: -300, max: 300, noNaN: true });
const yaw = fc.double({ min: -180, max: 180, noNaN: true });
const world: fc.Arbitrary<World> = fc.record({
  odomYawDeg: yaw,
  odomShift: fc.tuple(coord, coord),
  stored: fc.tuple(coord, coord, yaw),
  headingErrDeg: fc.double({ min: -20, max: 20, noNaN: true }),
  move: fc.tuple(
    fc.double({ min: -60, max: 60, noNaN: true }),
    fc.double({ min: -60, max: 60, noNaN: true }),
  ),
  turnDeg: yaw,
  // Offsets of the visitor from the physical code (m).
  walk: fc.array(
    fc.tuple(
      fc.double({ min: -50, max: 50, noNaN: true }),
      fc.double({ min: -50, max: 50, noNaN: true }),
    ),
    { minLength: 3, maxLength: 40 },
  ),
  bias: fc.tuple(
    fc.double({ min: -20, max: 20, noNaN: true }),
    fc.double({ min: -20, max: 20, noNaN: true }),
  ),
});

/** The pin of the code as the odometry sees it, and the fixes of the walk
 *  (exact odometry; GPS = truth + bias). */
function build(w: World): {
  pin: NonNullable<ReturnType<typeof pinCode>>;
  samples: DisplacementSample[];
} | null {
  const odomToWorld = new Matrix4().compose(
    new Vector3(w.odomShift[0], 0, w.odomShift[1]),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rad(w.odomYawDeg)),
    new Vector3(1, 1, 1),
  );
  const worldToOdom = odomToWorld.clone().invert();
  const [sn, se, sh] = w.stored;
  const physical = pose(
    sn + w.move[0],
    se + w.move[1],
    sh - w.headingErrDeg + w.turnDeg,
  );
  const seenM = worldToOdom
    .clone()
    .multiply(
      new Matrix4().compose(
        new Vector3(...physical.position),
        new Quaternion(...physical.rotation),
        new Vector3(1, 1, 1),
      ),
    );
  const p = new Vector3();
  const q = new Quaternion();
  seenM.decompose(p, q, new Vector3());
  const pin = pinCode(
    { position: [p.x, p.y, p.z], rotation: [q.x, q.y, q.z, q.w] },
    pose(sn, se, sh),
  );
  if (pin === null) return null;
  const samples = w.walk.map(([dn, de], i): DisplacementSample => {
    const n = physical.position[0] + dn;
    const e = physical.position[2] + de;
    const o = new Vector3(n, 1.4, e).applyMatrix4(worldToOdom);
    return {
      tMs: i * 1000,
      gps: [n + w.bias[0], e + w.bias[1]],
      odom: [o.x, o.z],
    };
  });
  return { pin, samples };
}

/** The walk has a real spread (a rigid fit needs a non-degenerate one). */
function spread(walk: readonly [number, number][]): number {
  const n = walk.length;
  const cn = walk.reduce((s, p) => s + p[0], 0) / n;
  const ce = walk.reduce((s, p) => s + p[1], 0) / n;
  return Math.sqrt(
    walk.reduce((s, p) => s + (p[0] - cn) ** 2 + (p[1] - ce) ** 2, 0) / n,
  );
}

describe("code displacement (properties)", () => {
  it("the rigid fit reads exactly the move plus the bias at the code, whatever the heading error or turn", () => {
    fc.assert(
      fc.property(world, (w) => {
        fc.pre(spread(w.walk) > 1);
        const built = build(w);
        if (built === null) return;
        const est = estimateCodeDisplacement(built.samples, built.pin, {
          kind: "rigid",
        });
        expect(est).not.toBeNull();
        expect(est!.displacementM[0]).toBeCloseTo(w.move[0] + w.bias[0], 5);
        expect(est!.displacementM[1]).toBeCloseTo(w.move[1] + w.bias[1], 5);
      }),
      { numRuns: 300 },
    );
  });

  it("the residual estimator leaks at most 2 sin(theta/2) R of a heading error and turn", () => {
    fc.assert(
      fc.property(world, fc.constantFrom(10, 20, 40), (w, radiusM) => {
        const built = build(w);
        if (built === null) return;
        const est = estimateCodeDisplacement(built.samples, built.pin, {
          kind: "residual",
          radiusM,
        });
        if (est === null) return; // no fix within R
        const turn = rad(w.turnDeg - w.headingErrDeg);
        const leak = 2 * Math.abs(Math.sin(turn / 2)) * radiusM;
        const dn = est.displacementM[0] - (w.move[0] + w.bias[0]);
        const de = est.displacementM[1] - (w.move[1] + w.bias[1]);
        expect(Math.hypot(dn, de)).toBeLessThanOrEqual(leak + 1e-6);
      }),
      { numRuns: 300 },
    );
  });

  it("the order of the fixes does not matter", () => {
    fc.assert(
      fc.property(world, fc.integer({ min: 1, max: 1000 }), (w, seed) => {
        const built = build(w);
        if (built === null) return;
        const shuffled = [...built.samples].sort(
          (a, b) => ((a.tMs * seed) % 97) - ((b.tMs * seed) % 97),
        );
        for (const estimator of [
          { kind: "rigid" } as const,
          { kind: "residual", radiusM: 40 } as const,
        ]) {
          const a = estimateCodeDisplacement(
            built.samples,
            built.pin,
            estimator,
          );
          const b = estimateCodeDisplacement(shuffled, built.pin, estimator);
          expect(a === null).toBe(b === null);
          if (a === null || b === null) continue;
          expect(b.displacementM[0]).toBeCloseTo(a.displacementM[0], 6);
          expect(b.displacementM[1]).toBeCloseTo(a.displacementM[1], 6);
          expect(b.spanS).toBe(a.spanS);
          expect(b.spreadM).toBeCloseTo(a.spreadM, 6);
          expect(b.samples).toBe(a.samples);
        }
      }),
      { numRuns: 200 },
    );
  });
});
