/**
 * Properties of the device-only refit (`code-device-fit.ts`).
 *
 * Why these tests matter: the settle trusts this fit as the visit's own
 * view of a code exactly because nothing of the code's stored position can
 * reach it. Two properties carry that: with exact fixes it recovers the
 * walk's true alignment, and it does not depend on the reference alignment
 * it is composed onto (the one a code's votes hold). If either broke, a
 * stored code could again confirm itself.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Matrix4, Quaternion, Vector3 } from "three";

import { deviceFitAlignment } from "./code-device-fit.js";
import type { DisplacementSample } from "./code-displacement.js";
import { throughAlignment } from "./visit-anchoring.js";

function yawAlignment(deg: number, t: [number, number, number]): number[] {
  const h = (deg * Math.PI) / 360;
  return new Matrix4()
    .compose(
      new Vector3(...t),
      new Quaternion(0, Math.sin(h), 0, Math.cos(h)),
      new Vector3(1, 1, 1),
    )
    .toArray();
}

const horizontalAt = (
  alignment: readonly number[],
  n: number,
  e: number,
): [number, number] => {
  const p = throughAlignment(
    { position: [n, 0, e], rotation: [0, 0, 0, 1] },
    alignment,
  )!.position;
  return [p[0], p[2]];
};

const yaw = fc.double({ min: -180, max: 180, noNaN: true });
const shift = fc.tuple(
  fc.double({ min: -500, max: 500, noNaN: true }),
  fc.double({ min: 300, max: 500, noNaN: true }),
  fc.double({ min: -500, max: 500, noNaN: true }),
);
/** A walk of 4-40 odometry points spread over at least a few metres. */
const path = fc
  .array(
    fc.tuple(
      fc.double({ min: -40, max: 40, noNaN: true }),
      fc.double({ min: -40, max: 40, noNaN: true }),
    ),
    { minLength: 4, maxLength: 40 },
  )
  .filter((pts) => {
    const n = pts.length;
    const mn = pts.reduce((a, p) => a + p[0], 0) / n;
    const me = pts.reduce((a, p) => a + p[1], 0) / n;
    const rms = Math.sqrt(
      pts.reduce((a, p) => a + (p[0] - mn) ** 2 + (p[1] - me) ** 2, 0) / n,
    );
    return rms >= 3;
  });

describe("deviceFitAlignment (properties)", () => {
  it("recovers the walk's alignment from exact fixes, whatever the reference", () => {
    fc.assert(
      fc.property(yaw, shift, yaw, shift, path, (ty, tt, ry, rt, pts) => {
        const truth = yawAlignment(ty, tt);
        const reference = yawAlignment(ry, rt);
        const samples: DisplacementSample[] = pts.map(([n, e], i) => ({
          tMs: i * 1000,
          gps: horizontalAt(truth, n, e),
          odom: [n, e],
        }));
        const fit = deviceFitAlignment(samples, reference);
        expect(fit).not.toBeNull();
        for (const [n, e] of [[0, 0], ...pts.slice(0, 3)] as const) {
          const got = horizontalAt(fit!.alignment, n, e);
          const want = horizontalAt(truth, n, e);
          expect(Math.hypot(got[0] - want[0], got[1] - want[1])).toBeLessThan(
            1e-5,
          );
        }
      }),
      { numRuns: 200 },
    );
  });

  it("gives the same horizontal alignment for any two references, noisy fixes included", () => {
    fc.assert(
      fc.property(
        yaw,
        shift,
        yaw,
        shift,
        path,
        fc.array(fc.double({ min: -8, max: 8, noNaN: true }), {
          minLength: 80,
          maxLength: 80,
        }),
        (ay, at, by, bt, pts, noise) => {
          const truth = yawAlignment(17, [10, 400, -20]);
          const samples: DisplacementSample[] = pts.map(([n, e], i) => {
            const g = horizontalAt(truth, n, e);
            return {
              tMs: i * 1000,
              gps: [g[0] + noise[2 * i]!, g[1] + noise[2 * i + 1]!],
              odom: [n, e],
            };
          });
          const a = deviceFitAlignment(samples, yawAlignment(ay, at));
          const b = deviceFitAlignment(samples, yawAlignment(by, bt));
          expect(a).not.toBeNull();
          expect(b).not.toBeNull();
          for (const [n, e] of [
            [0, 0],
            [25, -10],
          ] as const) {
            const pa = horizontalAt(a!.alignment, n, e);
            const pb = horizontalAt(b!.alignment, n, e);
            expect(Math.hypot(pa[0] - pb[0], pa[1] - pb[1])).toBeLessThan(1e-5);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
