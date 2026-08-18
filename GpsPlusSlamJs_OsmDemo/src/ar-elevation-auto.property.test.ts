/**
 * `arPointToSceneNue` against the three.js matrix oracle (cold-review F9).
 *
 * Why this test matters: the function hand-rolls a column-major 4×4 multiply
 * over a hand-rolled axis permutation (raw WebXR X=East/Y=Up/Z=South →
 * NUE `(−z, y, x)`), and BOTH are the kind of code where a transposed index
 * or a swapped axis produces plausible numbers for the identity-rotation
 * fixtures the example tests use. The oracle is the library the production
 * scene actually renders with: build the same NUE vector, push it through
 * `THREE.Vector3.applyMatrix4` on the same matrix, and demand agreement over
 * RANDOM yaws, translations and points — the space where every such bug is
 * visible. Yaw-only rotations are exactly the shape the fusion's alignment
 * takes (`DefaultAlignmentConfig`), so the quantifier matches production.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import * as THREE from "three";

import { arPointToSceneNue } from "./ar-elevation-auto.js";

/** Finite doubles in a range, NaN/-0 quirks excluded. */
const finite = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

describe("arPointToSceneNue matches THREE.Vector3.applyMatrix4 (property)", () => {
  it("agrees with the oracle over random yaw + translation alignments", () => {
    fc.assert(
      fc.property(
        finite(-Math.PI, Math.PI), // yaw
        finite(-1000, 1000), // translation north
        finite(-1000, 1000), // translation up
        finite(-1000, 1000), // translation east
        finite(-100, 100), // AR x (east)
        finite(-100, 100), // AR y (up)
        finite(-100, 100), // AR z (south)
        (yaw, tN, tU, tE, ax, ay, az) => {
          const m = new THREE.Matrix4().makeRotationY(yaw);
          m.setPosition(tN, tU, tE);

          // The oracle path: the SAME axis permutation the production code
          // documents (north = −z, up = y, east = x), then three's own
          // column-major multiply.
          const expected = new THREE.Vector3(-az, ay, ax).applyMatrix4(m);

          const out = arPointToSceneNue(m.elements, [ax, ay, az]);
          expect(out).toBeDefined();
          // Absolute-plus-relative tolerance: inputs reach ~1000 m where
          // float error scales with magnitude.
          const tol = 1e-9 * (1 + Math.abs(tN) + Math.abs(tU) + Math.abs(tE));
          expect(Math.abs((out?.north ?? NaN) - expected.x)).toBeLessThan(tol);
          expect(Math.abs((out?.up ?? NaN) - expected.y)).toBeLessThan(tol);
          expect(Math.abs((out?.east ?? NaN) - expected.z)).toBeLessThan(tol);
        },
      ),
    );
  });

  it("answers undefined, never NaN, when any input component is non-finite", () => {
    // The degrade-to-no-sample contract: a tracking glitch must not put a
    // NaN into the estimator's window through this seam.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 15 }), // which matrix element to poison
        fc.constantFrom(Number.NaN, Infinity, -Infinity),
        (index, poison) => {
          const m = new THREE.Matrix4().identity();
          m.elements[index] = poison;
          const out = arPointToSceneNue(m.elements, [1, 2, 3]);
          // Poisoning an element the multiply never reads (row 3) is allowed
          // to succeed; what is forbidden is a non-finite RESULT.
          const finiteOrRefused =
            out === undefined ||
            (Number.isFinite(out.north) &&
              Number.isFinite(out.up) &&
              Number.isFinite(out.east));
          expect(finiteOrRefused).toBe(true);
        },
      ),
    );
  });
});
