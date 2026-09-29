/**
 * Properties of the authoring settle's frame math (authoring plan
 * 2026-09-28-0953 §3.2, M2c, decision D10b).
 *
 * Why these properties matter: the code correction moves every note of a
 * later visit, so it must be a rigid, gravity-keeping move that puts the
 * measured code exactly on its stored pose - for ANY pose, not only the
 * hand-picked ones of the unit tests. The last property is what makes the
 * earlier visits' notes rigid in AR: the corrected alignment does not
 * depend on the visit's GPS alignment at all (both are yaw-only), so a GPS
 * re-solve cannot move a note that is placed through it.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { qrWorldPoseFromOdom } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";

import {
  codeCorrection,
  correctedAlignment,
  odomNueFromWebXr,
  throughAlignment,
  type NuePose,
} from "./visit-anchoring.js";

const coord = fc.double({ min: -200, max: 200, noNaN: true });
const vec3 = fc.tuple(coord, coord, coord);

/** Any unit quaternion (normalised from a non-degenerate 4-vector). */
const quat = fc
  .tuple(
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
  )
  .filter((q) => Math.hypot(...q) > 0.1)
  .map((q) => {
    const n = Math.hypot(...q);
    return [q[0] / n, q[1] / n, q[2] / n, q[3] / n] as [
      number,
      number,
      number,
      number,
    ];
  });

/** A code's pose as a pose solve gives it: any yaw, tilt within 30 deg. */
const codePose = fc
  .tuple(
    vec3,
    fc.double({ min: -180, max: 180, noNaN: true }),
    fc.double({ min: -30, max: 30, noNaN: true }),
    fc.double({ min: -30, max: 30, noNaN: true }),
  )
  .map(([position, yaw, pitch, roll]): NuePose => {
    const q = new Quaternion().setFromEuler(
      new Euler(
        (pitch * Math.PI) / 180,
        (yaw * Math.PI) / 180,
        (roll * Math.PI) / 180,
        "YXZ",
      ),
    );
    return {
      position,
      rotation: q.toArray(),
    };
  });

const yawAlignment = fc
  .tuple(fc.double({ min: -180, max: 180, noNaN: true }), vec3)
  .map(([deg, t]) =>
    new Matrix4()
      .compose(
        new Vector3(...t),
        new Quaternion().setFromAxisAngle(
          new Vector3(0, 1, 0),
          (deg * Math.PI) / 180,
        ),
        new Vector3(1, 1, 1),
      )
      .toArray(),
  );

function apply(m: readonly number[], p: readonly number[]): Vector3 {
  return new Vector3(p[0], p[1], p[2]).applyMatrix4(new Matrix4().fromArray(m));
}

describe("codeCorrection properties", () => {
  it("correcting a measurement onto itself is the identity", () => {
    fc.assert(
      fc.property(codePose, (code) => {
        const t = codeCorrection(code, code)!;
        const identity = new Matrix4().toArray();
        t.forEach((v, i) => {
          expect(v).toBeCloseTo(identity[i]!, 9);
        });
      }),
    );
  });

  it("puts the measured code exactly on the stored code", () => {
    fc.assert(
      fc.property(codePose, codePose, (measured, stored) => {
        const moved = apply(
          codeCorrection(measured, stored)!,
          measured.position,
        );
        expect(moved.distanceTo(new Vector3(...stored.position))).toBeLessThan(
          1e-7,
        );
      }),
    );
  });

  it("preserves every distance and every height difference", () => {
    fc.assert(
      fc.property(codePose, codePose, vec3, vec3, (measured, stored, a, b) => {
        const t = codeCorrection(measured, stored)!;
        const ta = apply(t, a);
        const tb = apply(t, b);
        const before = new Vector3(...a).distanceTo(new Vector3(...b));
        expect(ta.distanceTo(tb)).toBeCloseTo(before, 6);
        expect(ta.y - tb.y).toBeCloseTo(a[1] - b[1], 6);
      }),
    );
  });
});

describe("correctedAlignment properties", () => {
  it("does not depend on the visit's GPS alignment (why re-shown notes stay rigid)", () => {
    fc.assert(
      fc.property(
        yawAlignment,
        yawAlignment,
        codePose,
        codePose,
        (a, b, codeLocal, stored) => {
          const viaA = correctedAlignment(a, codeLocal, stored)!;
          const viaB = correctedAlignment(b, codeLocal, stored)!;
          viaA.forEach((v, i) => {
            expect(v).toBeCloseTo(viaB[i]!, 6);
          });
        },
      ),
    );
  });

  it("puts this visit's code on its stored position, through any alignment", () => {
    fc.assert(
      fc.property(yawAlignment, codePose, codePose, (a, codeLocal, stored) => {
        const corrected = correctedAlignment(a, codeLocal, stored)!;
        const placed = throughAlignment(codeLocal, corrected)!;
        expect(
          new Vector3(...placed.position).distanceTo(
            new Vector3(...stored.position),
          ),
        ).toBeLessThan(1e-6);
      }),
    );
  });
});

describe("odomNueFromWebXr property", () => {
  it("through any alignment, agrees with the framework's mint composition", () => {
    fc.assert(
      fc.property(vec3, quat, yawAlignment, (position, rotation, a) => {
        const viaLocal = throughAlignment(
          odomNueFromWebXr({ position, rotation }),
          a,
        )!;
        const direct = qrWorldPoseFromOdom({ position, rotation }, a);
        expect(
          new Vector3(...viaLocal.position).distanceTo(
            new Vector3(
              direct.position.x,
              direct.position.y,
              direct.position.z,
            ),
          ),
        ).toBeLessThan(1e-7);
        const dot = Math.abs(
          viaLocal.rotation.reduce(
            (sum, v, i) => sum + v * direct.rotation[i]!,
            0,
          ),
        );
        expect(dot).toBeCloseTo(1, 9);
      }),
    );
  });
});
