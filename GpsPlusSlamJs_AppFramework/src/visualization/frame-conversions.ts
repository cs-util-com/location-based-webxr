/**
 * `frame-conversions` — small, pure coordinate-frame helpers for the AR scene
 * graph. Currently a single function, `nueToArLocal`, that converts a
 * GPS-world NUE point into the AR-odometry local frame of `arWorldGroup`.
 *
 * Background: the scene root is GPS-world NUE; `arWorldGroup.matrix` IS the
 * alignment matrix, which maps **AR-odometry NUE → GPS-world NUE**. So a
 * direct child of `arWorldGroup` whose WORLD position must equal a GPS-world
 * point `nue` has to store `alignment⁻¹ · nue` as its LOCAL position —
 * writing raw `nue` double-applies the alignment. Getting this wrong was the
 * alignment-frame bug
 * (gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-gps-anchor-alignment-frame-bug.md);
 * this helper centralises the conversion behind one tested, well-named seam.
 *
 * Design (see the plan
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-nue-to-ar-local-helper-plan.md):
 *  - **Takes the explicit alignment matrix array**, NOT `Object3D.worldToLocal`.
 *    `worldToLocal` would read the live, mid-lerp `matrixWorld` and break
 *    replay determinism; the explicit target matrix keeps the result a pure
 *    function of its inputs. Full rationale in the review doc
 *    (gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-worldtolocal-frame-helper-review.md).
 *  - **Positions only.** No pose/quaternion variant exists until a caller
 *    needs one (YAGNI). A GPS-world ROTATION consumer now exists: ar/qr/qr-geo-pose-minting.ts takes the world quaternion directly (see its input docs for the getWorldQuaternion recipe); a conversion helper here is still unneeded because the WEBXR_TO_NUE-parented object already carries the right frame.
 */
import * as THREE from 'three';
import { calcGpsCoords } from '../core/index.js';
import type { LatLong, LatLongAlt } from '../core/index.js';

// Module-private scratch matrix — reused across calls to avoid per-call
// allocation on the GpsAnchor tick hot path. Not reentrant (no part of
// Three.js is); single-threaded JS makes that safe here.
const scratchMatrix = new THREE.Matrix4();

/**
 * Convert a GPS-world NUE point into the AR-local position to write into a
 * direct child of `arWorldGroup`, given the current alignment matrix.
 *
 * Computes `alignment⁻¹ · nue`. When the result is later composed back by the
 * group's matrix (the same `alignment`), the child's WORLD position equals
 * `nue` exactly.
 *
 * @param alignment - The alignment matrix as a 16-element **column-major**
 *   array (AR-odometry NUE → GPS-world NUE), e.g. from `getAlignmentMatrix()`
 *   or `THREE.Matrix4.toArray()`. Not mutated.
 * @param nue - The GPS-world NUE point `[north, up, east]` in metres. Not
 *   mutated.
 * @param out - Optional target vector to write into and return (pass a reused
 *   scratch to avoid allocation on hot paths). Defaults to a fresh
 *   `THREE.Vector3`.
 * @returns `out`, set to the AR-local position.
 */
export function nueToArLocal(
  alignment: readonly number[],
  nue: readonly [number, number, number],
  out: THREE.Vector3 = new THREE.Vector3()
): THREE.Vector3 {
  scratchMatrix.fromArray(alignment).invert();
  return out.set(nue[0], nue[1], nue[2]).applyMatrix4(scratchMatrix);
}

/**
 * Convert an object's **GPS-world NUE world position** back into a GPS
 * coordinate, for the GPS-anchor bootstrap that medians where an object was
 * actually placed (mirrors the C# `DetermineAndStoreGpsWorldPose`, which
 * medians the object's world pose and converts via `zero.CalcGpsCoordsOf`).
 *
 * Precondition: `worldNue` must already be in GPS-world NUE — i.e. the object
 * lives under an `arWorldGroup` whose `.matrix` carries the alignment (see
 * `enableArWorldGroupAlignment`), so `object3D.getWorldPosition()` is the
 * GPS-world position. Sampling a pure-VIO (identity-`arWorldGroup`) world
 * position would yield a wrong GPS coordinate.
 *
 * Altitude round-trip: `calcGpsCoords` returns only `lat`/`lon` (it derives
 * them from the North/East axes and ignores Up). The Up axis (`worldNue.y`,
 * NUE index 1) is carried through verbatim as `altitude`, so a later
 * `calcRelativeCoordsInMeters(zero, result, result.altitude, 0)` reproduces the
 * same Up value — keeping the steady-state vertical target consistent with
 * where the object was sampled.
 *
 * @param worldNue - The object's world position in GPS-world NUE metres
 *   (`x = North`, `y = Up`, `z = East`). A `THREE.Vector3` satisfies this.
 * @param zero - The GPS zero reference (origin for the conversion).
 * @returns The GPS coordinate of `worldNue`, with `altitude = worldNue.y`.
 */
export function worldNueToGps(
  worldNue: { readonly x: number; readonly y: number; readonly z: number },
  zero: LatLong
): LatLongAlt {
  const gps = calcGpsCoords(zero, [worldNue.x, worldNue.y, worldNue.z]);
  return { lat: gps.lat, lon: gps.lon, altitude: worldNue.y };
}
