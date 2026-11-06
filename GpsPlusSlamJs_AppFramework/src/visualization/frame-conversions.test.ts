/**
 * Unit tests for `nueToArLocal` — the GPS-world NUE → AR-local point helper.
 *
 * Why these tests matter: this helper centralises the `alignment⁻¹ · nue`
 * conversion that the `GpsAnchor` alignment-frame bug
 * (gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-gps-anchor-alignment-frame-bug.md)
 * got wrong by omission. The defining contract is the **round-trip**:
 * applying the forward alignment to the helper's output must return the
 * original GPS-world point. Each test below doubles as executable
 * documentation of *how* and *why* a caller uses the helper — most
 * importantly `createGpsAnchor.maybeCommitSteadyState`, which writes the
 * result into the local `position` of a child of `arWorldGroup` (whose
 * `matrix` IS the alignment) so the object's WORLD position lands on `nue`.
 *
 * The fixtures deliberately avoid the identity matrix: `identity⁻¹ · x === x`
 * makes a whole family of wrong implementations (identity, double-apply,
 * forward instead of inverse, transpose) indistinguishable from the correct
 * one. We default to `makeNonTrivialAlignment` (rigid, non-axis rotation +
 * translation) and keep identity only as an explicit degenerate corollary.
 */
// Activates the core library's licence before any module under test loads.
import '../test-setup';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { nueToArLocal, worldNueToGps } from './frame-conversions.js';
import { makeNonTrivialAlignment } from '../test-utils/non-trivial-alignment.js';
import { calcRelativeCoordsInMeters } from '../core/index.js';

/** Forward-apply a column-major alignment array to a point — the inverse of
 * what `nueToArLocal` does. Used to verify the round-trip independently of
 * the helper's own internals. */
function applyForward(
  alignment: readonly number[],
  local: THREE.Vector3
): THREE.Vector3 {
  const m = new THREE.Matrix4().fromArray(alignment);
  return local.clone().applyMatrix4(m);
}

describe('nueToArLocal', () => {
  it('round-trips: alignment · nueToArLocal(alignment, nue) ≈ nue', () => {
    // The core contract. For several distinct non-trivial alignments, the
    // helper output mapped forward by the same alignment must return to the
    // original GPS-world point. This is the executable spec of what the
    // helper is *for*: pre-image of `nue` under the alignment.
    for (let seed = 1; seed <= 8; seed++) {
      const alignment = makeNonTrivialAlignment(seed);
      const nue: [number, number, number] = [3 + seed, -7 + seed, 11 - seed];
      const local = nueToArLocal(alignment, nue);
      const back = applyForward(alignment, local);
      expect(back.x).toBeCloseTo(nue[0], 9);
      expect(back.y).toBeCloseTo(nue[1], 9);
      expect(back.z).toBeCloseTo(nue[2], 9);
    }
  });

  it('matches the open-coded invert-and-apply it replaces (bit-for-bit)', () => {
    // Guards the refactor: the helper must compute exactly what
    // `maybeCommitSteadyState` used to do inline (fromArray → copy → invert →
    // applyMatrix4). Any divergence here would be a silent behaviour change.
    const alignment = makeNonTrivialAlignment(42);
    const nue: [number, number, number] = [12.5, -4.25, 8.125];

    const expectedM = new THREE.Matrix4().fromArray(alignment);
    const expectedInv = new THREE.Matrix4().copy(expectedM).invert();
    const expected = new THREE.Vector3(nue[0], nue[1], nue[2]).applyMatrix4(
      expectedInv
    );

    const actual = nueToArLocal(alignment, nue);
    expect(actual.x).toBe(expected.x);
    expect(actual.y).toBe(expected.y);
    expect(actual.z).toBe(expected.z);
  });

  it('identity alignment leaves the point unchanged (degenerate corollary)', () => {
    // With alignment = I the AR-odometry frame and the GPS-world frame
    // coincide, so the local target equals the raw NUE point. This is the
    // exact case that hid the original bug — kept as an explicit corollary,
    // never as the primary fixture.
    const identity = new THREE.Matrix4().identity().toArray();
    const nue: [number, number, number] = [1, 2, 3];
    const local = nueToArLocal(identity, nue);
    expect(local.x).toBeCloseTo(1, 12);
    expect(local.y).toBeCloseTo(2, 12);
    expect(local.z).toBeCloseTo(3, 12);
  });

  it('pure translation subtracts the offset', () => {
    // A translation-only alignment maps AR-local p → p + t in world. The
    // inverse therefore maps a world point back by −t. A hand-checkable case
    // that pins down the *direction* of the transform (catches a forward-vs-
    // inverse mix-up that the round-trip alone could not, since both
    // directions round-trip).
    const t = new THREE.Vector3(10, -5, 7);
    const translation = new THREE.Matrix4()
      .makeTranslation(t.x, t.y, t.z)
      .toArray();
    const nue: [number, number, number] = [4, 4, 4];
    const local = nueToArLocal(translation, nue);
    expect(local.x).toBeCloseTo(4 - 10, 12);
    expect(local.y).toBeCloseTo(4 - -5, 12);
    expect(local.z).toBeCloseTo(4 - 7, 12);
  });

  it('pure rotation about Y maps a world point into the rotated frame', () => {
    // A 90° rotation about +Y maps AR-local +X → world +? Verifies the
    // helper applies the *inverse* rotation. For R = rotY(90°), R·(1,0,0) =
    // (0,0,-1); so the world point (0,0,-1) must map back to local (1,0,0).
    const rotY90 = new THREE.Matrix4().makeRotationY(Math.PI / 2).toArray();
    const worldPoint: [number, number, number] = [0, 0, -1];
    const local = nueToArLocal(rotY90, worldPoint);
    expect(local.x).toBeCloseTo(1, 9);
    expect(local.y).toBeCloseTo(0, 9);
    expect(local.z).toBeCloseTo(0, 9);
  });

  it('writes into the provided `out` vector and returns the same instance', () => {
    // Hot-path usage: callers pass a reused scratch vector to avoid per-tick
    // allocation (exactly how `maybeCommitSteadyState` calls it). The helper
    // must mutate and return that very instance.
    const alignment = makeNonTrivialAlignment(3);
    const out = new THREE.Vector3(999, 999, 999);
    const returned = nueToArLocal(alignment, [1, 2, 3], out);
    expect(returned).toBe(out);
    // And the scratch was actually overwritten (not left at the sentinel).
    expect(out.x).not.toBe(999);
  });

  it('allocates a fresh vector when no `out` is supplied', () => {
    // Convenience usage for one-off conversions / tests. Two calls must not
    // alias the same instance.
    const alignment = makeNonTrivialAlignment(5);
    const a = nueToArLocal(alignment, [1, 2, 3]);
    const b = nueToArLocal(alignment, [4, 5, 6]);
    expect(a).toBeInstanceOf(THREE.Vector3);
    expect(a).not.toBe(b);
  });

  it('does not mutate the input alignment array or the nue tuple', () => {
    // Defensive contract: the helper reads its inputs, it must not write
    // them. Callers pass the live store alignment array and a derived NUE
    // tuple; mutating either would corrupt shared state.
    const alignment = makeNonTrivialAlignment(7);
    const alignmentCopy = [...alignment];
    const nue: [number, number, number] = [9, -9, 0.5];
    const nueCopy: [number, number, number] = [...nue];
    nueToArLocal(alignment, nue);
    expect([...alignment]).toEqual(alignmentCopy);
    expect(nue).toEqual(nueCopy);
  });

  it('preserves Euclidean distances under a rigid alignment', () => {
    // The threshold gate in `GpsAnchor` compares metre distances in the
    // AR-local frame against a metre threshold defined in world terms. That
    // is only meaningful if the (rigid, unit-scale) alignment preserves
    // distance — verify the inverse mapping does so. Two world points the
    // same distance apart must map to two local points the same distance
    // apart.
    const alignment = makeNonTrivialAlignment(11);
    const p1: [number, number, number] = [0, 0, 0];
    const p2: [number, number, number] = [3, 4, 0]; // 5 m apart
    const l1 = nueToArLocal(alignment, p1);
    const l2 = nueToArLocal(alignment, p2);
    expect(l1.distanceTo(l2)).toBeCloseTo(5, 9);
  });
});

/**
 * Unit tests for `worldNueToGps` — the inverse used by the GPS-anchor bootstrap
 * to convert the object's GPS-world NUE world position back into a GPS
 * coordinate (the C# `DetermineAndStoreGpsWorldPose` model). The defining
 * contract is the **round-trip** against `calcRelativeCoordsInMeters`: a GPS
 * point converted to NUE and back must return the same GPS point, and the Up
 * (altitude) axis must survive the trip even though `calcGpsCoords` itself
 * returns only lat/lon.
 */
describe('worldNueToGps', () => {
  it('round-trips GPS → NUE → GPS for several offsets', () => {
    const zero = { lat: 48.137, lon: 11.575 };
    // A spread of targets around the origin (north/south, east/west, up).
    const targets = [
      { lat: 48.138, lon: 11.575, altitude: 12 },
      { lat: 48.136, lon: 11.576, altitude: -5 },
      { lat: 48.1375, lon: 11.574, altitude: 0 },
    ];
    for (const target of targets) {
      const nue = calcRelativeCoordsInMeters(zero, target, target.altitude, 0);
      const worldNue = new THREE.Vector3(nue[0], nue[1], nue[2]);
      const gps = worldNueToGps(worldNue, zero);
      expect(gps.lat).toBeCloseTo(target.lat, 6);
      expect(gps.lon).toBeCloseTo(target.lon, 6);
      // Altitude is carried from the Up axis (NUE index 1) verbatim.
      expect(gps.altitude).toBeCloseTo(target.altitude, 6);
    }
  });

  it('carries the Up axis (NUE y) through as altitude', () => {
    // calcGpsCoords ignores Up for lat/lon; worldNueToGps must still surface
    // the Up component as altitude so the steady-state vertical target
    // reproduces where the object was sampled.
    const zero = { lat: 0, lon: 0 };
    const gps = worldNueToGps({ x: 0, y: 42.5, z: 0 }, zero);
    expect(gps.altitude).toBeCloseTo(42.5, 9);
  });

  it('accepts a plain {x,y,z} as well as a THREE.Vector3', () => {
    const zero = { lat: 10, lon: 20 };
    const fromPlain = worldNueToGps({ x: 5, y: 1, z: -3 }, zero);
    const fromVec = worldNueToGps(new THREE.Vector3(5, 1, -3), zero);
    expect(fromPlain.lat).toBeCloseTo(fromVec.lat, 12);
    expect(fromPlain.lon).toBeCloseTo(fromVec.lon, 12);
    expect(fromPlain.altitude).toBe(fromVec.altitude);
  });
});
