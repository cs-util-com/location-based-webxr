/**
 * AR Types Tests
 *
 * Why this test matters:
 * Validates that the shared AR type definitions have the expected structure.
 * These tests ensure type consistency across modules that depend on these
 * shared types (depth-sampler.ts, store.ts, etc.) and catch accidental
 * breaking changes to the type structure.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import * as fc from 'fast-check';
import type { Vector3, Quaternion } from 'gps-plus-slam-js';
import type {
  ARPose,
  ArPoseTuples,
  DepthPoint,
  DepthSample,
  WebXRVec3,
  WebXRQuaternion,
} from './ar-types';
import type { ImageCaptureCallbacks } from '../ar/image-capture';
import type {
  DepthSample as StoreDepthSample,
  DepthPoint as StoreDepthPoint,
} from './ar-types';

// STATIC, NOT `await import(...)` INSIDE THE TESTS, and that is the whole point
// of this block (2026-08-09). These three modules were imported dynamically from
// within test bodies, which put a module graph — `gps-plus-slam-js`, redux
// toolkit, the store types — inside vitest's 5 s PER-TEST budget. Uncontended
// that is invisible: this file runs in 767 ms. Under the root cascade's parallel
// load, where this worker may be the first to pull that graph, it twice blew the
// budget and failed the whole 21-minute gate on
// `extractOdomPosition returns Vector3`.
//
// Hoisting does not make the work cheaper, it moves it out of a per-test cap and
// into module load, which has none — and `gps-event-coordinator.property.test.ts`
// already imports the same module this way without ever timing out.
import { DepthSampler } from '../ar/depth-sampler';
import { recordDepthSample } from '../state/recording-slice';
import {
  eulerToQuaternion,
  extractOdomPosition,
  extractOdomRotation,
} from '../state/gps-event-coordinator';

describe('AR Types', () => {
  describe('ARPose', () => {
    it('has the expected structure', () => {
      const pose: ARPose = {
        position: { x: 1, y: 2, z: 3 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      };

      expect(pose.position).toHaveProperty('x');
      expect(pose.position).toHaveProperty('y');
      expect(pose.position).toHaveProperty('z');
      expect(pose.orientation).toHaveProperty('x');
      expect(pose.orientation).toHaveProperty('y');
      expect(pose.orientation).toHaveProperty('z');
      expect(pose.orientation).toHaveProperty('w');
    });

    it('position coordinates are numbers', () => {
      const pose: ARPose = {
        position: { x: 1.5, y: -2.3, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      };

      expect(typeof pose.position.x).toBe('number');
      expect(typeof pose.position.y).toBe('number');
      expect(typeof pose.position.z).toBe('number');
    });

    it('orientation is a quaternion with w component', () => {
      const pose: ARPose = {
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 },
      };

      expect(typeof pose.orientation.x).toBe('number');
      expect(typeof pose.orientation.y).toBe('number');
      expect(typeof pose.orientation.z).toBe('number');
      expect(typeof pose.orientation.w).toBe('number');
    });
  });

  describe('DepthPoint', () => {
    it('has the expected structure with canonical property names', () => {
      const point: DepthPoint = {
        screenX: 0.5,
        screenY: 0.5,
        depthM: 2.5,
      };

      // Verify canonical property names (not depth/x/y)
      expect(point).toHaveProperty('screenX');
      expect(point).toHaveProperty('screenY');
      expect(point).toHaveProperty('depthM');
    });

    it('screenX and screenY are normalized coordinates (0-1)', () => {
      const point: DepthPoint = {
        screenX: 0.25,
        screenY: 0.75,
        depthM: 1.0,
      };

      expect(point.screenX).toBeGreaterThanOrEqual(0);
      expect(point.screenX).toBeLessThanOrEqual(1);
      expect(point.screenY).toBeGreaterThanOrEqual(0);
      expect(point.screenY).toBeLessThanOrEqual(1);
    });

    it('depthM is in meters', () => {
      const point: DepthPoint = {
        screenX: 0.5,
        screenY: 0.5,
        depthM: 3.5, // 3.5 meters
      };

      expect(typeof point.depthM).toBe('number');
      expect(point.depthM).toBe(3.5);
    });

    it('can represent edge cases', () => {
      // Corner points
      const topLeft: DepthPoint = { screenX: 0, screenY: 0, depthM: 0.1 };
      const bottomRight: DepthPoint = { screenX: 1, screenY: 1, depthM: 100 };

      expect(topLeft.screenX).toBe(0);
      expect(topLeft.screenY).toBe(0);
      expect(bottomRight.screenX).toBe(1);
      expect(bottomRight.screenY).toBe(1);
    });
  });

  // DELETED 2026-08-09: two tests that asserted nothing.
  //
  // `DepthPoint is re-exported from depth-sampler` and `... from
  // gps-plus-slam-js` each did `await import(...)` and then
  // `expect(theModule).toBeDefined()`. A module namespace object is always
  // defined once the import resolves, so neither could fail for the reason it
  // named — and their own comment said as much: _"If DepthPoint wasn't
  // re-exported, this would fail at compile time"_. That compile-time check is
  // real and is what `typecheck:tests` runs; the runtime half was a whole-library
  // import bought for a tautology.
  //
  // The re-export they meant to guard is still guarded: `DepthPoint` is imported
  // as a type at the top of this file, so `typecheck:tests` fails if it stops
  // being exported.

  describe('Cross-module type consistency', () => {
    /**
     * Why this test matters:
     * Ensures DepthSample.points from depth-sampler uses the same DepthPoint
     * structure as the canonical definition. If someone accidentally creates
     * a different local interface, this test will catch the mismatch.
     */
    it('depth-sampler DepthSample.points matches canonical DepthPoint structure', () => {
      const capturedSamples: Array<{ points: readonly DepthPoint[] }> = [];
      const sampler = new DepthSampler({
        onSampleCaptured: (sample) => capturedSamples.push(sample),
        getCurrentPose: () => ({
          position: { x: 0, y: 0, z: 0 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        }),
      });

      sampler.start();
      sampler.onFrame(0, () => ({
        width: 100,
        height: 100,
        getDepthInMeters: () => 2.5,
      }));
      sampler.stop();

      expect(capturedSamples).toHaveLength(1);
      const point = capturedSamples[0].points[0];

      // Verify the exact property names match canonical definition
      expect(Object.keys(point).sort()).toEqual(
        ['depthM', 'screenX', 'screenY'].sort()
      );

      // Verify types
      expect(typeof point.screenX).toBe('number');
      expect(typeof point.screenY).toBe('number');
      expect(typeof point.depthM).toBe('number');
    });

    /**
     * Why this test matters:
     * The store re-exports DepthSample and DepthPoint from ar-types.ts so
     * consumers don't need a second import. This type-level guard catches
     * divergent local types in the store that drift from the canonical ones.
     */
    it('store re-exports the canonical DepthSample and DepthPoint types', () => {
      expectTypeOf<StoreDepthSample>().toEqualTypeOf<DepthSample>();
      expectTypeOf<StoreDepthPoint>().toEqualTypeOf<DepthPoint>();
    });

    /**
     * Why this test matters:
     * Verifies that a DepthSample produced by DepthSampler can be dispatched
     * to the store's recordDepthSample action without transformation, proving
     * end-to-end compatibility between the sampler and the store at runtime.
     */
    it('DepthSampler produces a sample compatible with the store', () => {
      expect(recordDepthSample).toBeDefined();

      const capturedSamples: DepthSample[] = [];
      const sampler = new DepthSampler({
        onSampleCaptured: (sample) => capturedSamples.push(sample),
        getCurrentPose: () => ({
          position: { x: 0, y: 0, z: 0 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        }),
      });

      sampler.start();
      sampler.onFrame(0, () => ({
        width: 100,
        height: 100,
        getDepthInMeters: () => 2.5,
      }));
      sampler.stop();

      expect(capturedSamples).toHaveLength(1);
      const sample = capturedSamples[0];
      expect(sample.points[0]).toHaveProperty('screenX');
      expect(sample.points[0]).toHaveProperty('screenY');
      expect(sample.points[0]).toHaveProperty('depthM');
    });
  });

  describe('Property-based tests', () => {
    /**
     * Why this test matters:
     * Verifies DepthPoint can represent any valid normalized screen coordinate.
     * Property-based testing catches edge cases that example-based tests miss.
     */
    it('DepthPoint accepts any normalized screen coordinates', () => {
      fc.assert(
        fc.property(
          fc.float({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
          fc.float({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
          fc.float({
            min: Math.fround(0.01),
            max: 100,
            noNaN: true,
            noDefaultInfinity: true,
          }),
          (screenX, screenY, depthM) => {
            const point: DepthPoint = { screenX, screenY, depthM };

            expect(point.screenX).toBeGreaterThanOrEqual(0);
            expect(point.screenX).toBeLessThanOrEqual(1);
            expect(point.screenY).toBeGreaterThanOrEqual(0);
            expect(point.screenY).toBeLessThanOrEqual(1);
            expect(point.depthM).toBeGreaterThan(0);
          }
        )
      );
    });

    /**
     * Why this test matters:
     * ARPose must handle any valid 3D position and quaternion orientation.
     */
    it('ARPose accepts any valid position and orientation', () => {
      fc.assert(
        fc.property(
          fc.record({
            x: fc.float({ min: -1000, max: 1000, noNaN: true }),
            y: fc.float({ min: -1000, max: 1000, noNaN: true }),
            z: fc.float({ min: -1000, max: 1000, noNaN: true }),
          }),
          fc.record({
            x: fc.float({ min: -1, max: 1, noNaN: true }),
            y: fc.float({ min: -1, max: 1, noNaN: true }),
            z: fc.float({ min: -1, max: 1, noNaN: true }),
            w: fc.float({ min: -1, max: 1, noNaN: true }),
          }),
          (position, orientation) => {
            const pose: ARPose = { position, orientation };

            expect(typeof pose.position.x).toBe('number');
            expect(typeof pose.position.y).toBe('number');
            expect(typeof pose.position.z).toBe('number');
            expect(typeof pose.orientation.x).toBe('number');
            expect(typeof pose.orientation.y).toBe('number');
            expect(typeof pose.orientation.z).toBe('number');
            expect(typeof pose.orientation.w).toBe('number');
          }
        )
      );
    });

    /**
     * Why this test matters:
     * Ensures multiple DepthPoints can be stored in an array without data loss.
     * This is how they're used in DepthSample.points.
     */
    it('array of DepthPoints preserves all values', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              screenX: fc.float({
                min: 0,
                max: 1,
                noNaN: true,
                noDefaultInfinity: true,
              }),
              screenY: fc.float({
                min: 0,
                max: 1,
                noNaN: true,
                noDefaultInfinity: true,
              }),
              depthM: fc.float({
                min: Math.fround(0.01),
                max: 100,
                noNaN: true,
                noDefaultInfinity: true,
              }),
            }),
            { minLength: 1, maxLength: 25 }
          ),
          (points: DepthPoint[]) => {
            // Serialize and deserialize (simulating storage/transmission)
            const serialized = JSON.stringify(points);
            const deserialized = JSON.parse(serialized) as DepthPoint[];

            expect(deserialized).toHaveLength(points.length);
            for (let i = 0; i < points.length; i++) {
              expect(deserialized[i].screenX).toBeCloseTo(points[i].screenX, 5);
              expect(deserialized[i].screenY).toBeCloseTo(points[i].screenY, 5);
              expect(deserialized[i].depthM).toBeCloseTo(points[i].depthM, 5);
            }
          }
        )
      );
    });
  });

  describe('Regression guards', () => {
    /**
     * Why this test matters:
     * Guards against accidentally renaming properties. If someone changes
     * 'depthM' back to 'depth', this test will fail immediately.
     */
    it('rejects objects with old property names (depth/x/y)', () => {
      const oldStylePoint = { depth: 2.5, x: 0.5, y: 0.5 };

      // Old-style point should NOT have the canonical properties
      expect(oldStylePoint).not.toHaveProperty('screenX');
      expect(oldStylePoint).not.toHaveProperty('screenY');
      expect(oldStylePoint).not.toHaveProperty('depthM');
    });

    /**
     * Why this test matters:
     * Ensures the canonical type doesn't accidentally gain extra properties.
     */
    it('DepthPoint has exactly 3 properties', () => {
      const point: DepthPoint = { screenX: 0.5, screenY: 0.5, depthM: 2.0 };
      expect(Object.keys(point)).toHaveLength(3);
    });

    /**
     * Why this test matters:
     * ARPose must have exactly position and orientation, nothing else.
     */
    it('ARPose has exactly 2 top-level properties', () => {
      const pose: ARPose = {
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      };
      expect(Object.keys(pose)).toHaveLength(2);
    });
  });

  describe('Single-source-of-truth: ARPose from ar-types.ts', () => {
    /**
     * Why this test matters:
     * image-capture.ts previously defined its own duplicate ARPose interface
     * "to avoid circular dependency". This test proves the canonical ARPose
     * from ar-types.ts is the only definition used across the codebase.
     * If someone re-introduces a local duplicate that drifts structurally,
     * the compile-time import + runtime assignability check here will catch it.
     */
    it('canonical ARPose satisfies ImageCaptureCallbacks.getCurrentPose return type', () => {
      const pose: ARPose = {
        position: { x: 1, y: 2, z: 3 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      };

      // Verify that the canonical ARPose is assignable to the return type
      // of ImageCaptureCallbacks.getCurrentPose (ARPose | null).
      // This is a compile-time + runtime check: if image-capture.ts ever
      // defines ARPose differently from ar-types.ts, TypeScript will error here.
      const getCurrentPose: ImageCaptureCallbacks['getCurrentPose'] = () =>
        pose;
      const result = getCurrentPose();

      expect(result).toEqual(pose);
      expect(result?.position).toEqual({ x: 1, y: 2, z: 3 });
      expect(result?.orientation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    });

    it('null is a valid getCurrentPose return (no pose available)', () => {
      const getCurrentPose: ImageCaptureCallbacks['getCurrentPose'] = () =>
        null;
      expect(getCurrentPose()).toBeNull();
    });

    /**
     * Why this test matters:
     * Proves bidirectional assignability — a value returned by getCurrentPose
     * can be used wherever ARPose is expected.
     */
    it('getCurrentPose return type is assignable back to ARPose', () => {
      const callbacks: ImageCaptureCallbacks = {
        getCurrentPose: () => ({
          position: { x: 5, y: 6, z: 7 },
          orientation: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 },
        }),
        getScreenRotation: () => 0,
        onCaptured: () => {},
      };

      const maybeResult = callbacks.getCurrentPose();
      expect(maybeResult).not.toBeNull();

      // Assign to a typed ARPose variable — proves the types are identical
      const pose: ARPose = maybeResult!;
      expectTypeOf(pose).toMatchTypeOf<ARPose>();
      expect(pose.position.x).toBe(5);
    });
  });

  describe('ArPoseTuples', () => {
    /**
     * Why this test matters:
     * ArPoseTuples is the tuple-form equivalent of ARPose, used in storage
     * interfaces where poses are serialized as plain number arrays rather
     * than object-form { x, y, z }. This confirms the type has the expected
     * shape and uses the library's Vector3/Quaternion types.
     */
    it('has position (Vector3) and rotation (Quaternion) fields', () => {
      const pose: ArPoseTuples = {
        position: [1, 2, 3],
        rotation: [0, 0, 0, 1],
      };

      expect(pose.position).toEqual([1, 2, 3]);
      expect(pose.rotation).toEqual([0, 0, 0, 1]);
      expect(Object.keys(pose).sort()).toEqual(['position', 'rotation']);
    });

    it('position is a readonly 3-tuple (Vector3)', () => {
      const pose: ArPoseTuples = {
        position: [10, 20, 30],
        rotation: [0, 0, 0, 1],
      };

      expectTypeOf(pose.position).toMatchTypeOf<Vector3>();
      expect(pose.position).toHaveLength(3);
    });

    it('rotation is a readonly 4-tuple (Quaternion)', () => {
      const pose: ArPoseTuples = {
        position: [0, 0, 0],
        rotation: [0.1, 0.2, 0.3, 0.9],
      };

      expectTypeOf(pose.rotation).toMatchTypeOf<Quaternion>();
      expect(pose.rotation).toHaveLength(4);
    });

    /**
     * Why this test matters:
     * ArPoseTuples must survive JSON round-trip since it is used in storage
     * interfaces that serialize to/from JSON files.
     */
    it('survives JSON round-trip', () => {
      const original: ArPoseTuples = {
        position: [1.5, -2.3, 0.7],
        rotation: [0.1, 0.2, 0.3, 0.9],
      };
      const roundTripped = JSON.parse(JSON.stringify(original)) as ArPoseTuples;

      expect(roundTripped.position).toEqual(original.position);
      expect(roundTripped.rotation).toEqual(original.rotation);
    });
  });

  describe('ArPoseTuples property-based tests', () => {
    /**
     * Why this test matters:
     * Verifies ArPoseTuples works with any valid position/rotation values.
     */
    it('accepts any finite position and rotation values', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.float({ min: -1000, max: 1000, noNaN: true }),
            fc.float({ min: -1000, max: 1000, noNaN: true }),
            fc.float({ min: -1000, max: 1000, noNaN: true })
          ),
          fc.tuple(
            fc.float({ min: -1, max: 1, noNaN: true }),
            fc.float({ min: -1, max: 1, noNaN: true }),
            fc.float({ min: -1, max: 1, noNaN: true }),
            fc.float({ min: -1, max: 1, noNaN: true })
          ),
          (position, rotation) => {
            const pose: ArPoseTuples = { position, rotation };
            expect(pose.position).toHaveLength(3);
            expect(pose.rotation).toHaveLength(4);
          }
        )
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Inline tuple → Vector3/Quaternion migration guards (Finding #1)
  // ──────────────────────────────────────────────────────────────────────────

  describe('DepthSample uses library Vector3/Quaternion types', () => {
    /**
     * Why this test matters:
     * DepthSample.cameraPos was previously typed as mutable [number, number, number].
     * This test ensures it uses the library's readonly Vector3 type, preventing
     * accidental mutation and maintaining consistency with ArPoseTuples.
     */
    it('DepthSample.cameraPos is Vector3 (readonly tuple)', () => {
      const sample: DepthSample = {
        timestamp: 1000,
        cameraPos: [1, 2, 3],
        cameraRot: [0, 0, 0, 1],
        points: [],
      };
      expectTypeOf(sample.cameraPos).toEqualTypeOf<Vector3>();
    });

    /**
     * Why this test matters:
     * DepthSample.cameraRot was previously typed as mutable [number, number, number, number].
     * This test ensures it uses the library's readonly Quaternion type.
     */
    it('DepthSample.cameraRot is Quaternion (readonly tuple)', () => {
      const sample: DepthSample = {
        timestamp: 1000,
        cameraPos: [1, 2, 3],
        cameraRot: [0, 0, 0, 1],
        points: [],
      };
      expectTypeOf(sample.cameraRot).toEqualTypeOf<Quaternion>();
    });
  });

  describe('gps-event-coordinator returns library tuple types', () => {
    /**
     * Why this test matters:
     * extractOdomPosition previously returned mutable [number, number, number].
     * Since RecordGpsEventPayload.odomPosition is Vector3, the extractor
     * should return Vector3 directly for type consistency.
     */
    it('extractOdomPosition returns Vector3', () => {
      const pose: ARPose = {
        position: { x: 1, y: 2, z: 3 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      };
      const result = extractOdomPosition(pose);
      expectTypeOf(result).toEqualTypeOf<Vector3>();
      // WebXR {x:1,y:2,z:3} → raw WebXR [x,y,z] = [1, 2, 3]
      expect(result).toEqual([1, 2, 3]);
    });

    /**
     * Why this test matters:
     * extractOdomRotation previously returned mutable [number, number, number, number].
     * Since RecordGpsEventPayload.odomRotation is Quaternion, the extractor
     * should return Quaternion directly for type consistency.
     */
    it('extractOdomRotation returns Quaternion', () => {
      const pose: ARPose = {
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 },
      };
      const result = extractOdomRotation(pose);
      expectTypeOf(result).toEqualTypeOf<Quaternion>();
      expect(result).toEqual([0.1, 0.2, 0.3, 0.9]);
    });

    /**
     * Why this test matters:
     * eulerToQuaternion previously returned mutable [number, number, number, number].
     * It should return Quaternion for consistency with the library types.
     */
    it('eulerToQuaternion returns Quaternion', () => {
      const result = eulerToQuaternion(0, 0, 0);
      expectTypeOf(result).toEqualTypeOf<Quaternion>();
      expect(result).toHaveLength(4);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // WebXRVec3 / WebXRQuaternion type-contract
  // ──────────────────────────────────────────────────────────────────────────

  describe('WebXRVec3 and WebXRQuaternion', () => {
    // Why these tests matter: WebXRVec3 and WebXRQuaternion are the canonical
    // object-form sub-types extracted from ARPose (Finding #8). They replace
    // inline { x, y, z } and { x, y, z, w } shapes across image-capture.ts
    // and browser-mocks.ts. Named after WebXR to distinguish them from the
    // library's tuple-form Vector3/Quaternion.

    it('WebXRVec3 has exactly x, y, z number fields', () => {
      const pos: WebXRVec3 = { x: 1.5, y: -2.3, z: 0.0 };
      expect(typeof pos.x).toBe('number');
      expect(typeof pos.y).toBe('number');
      expect(typeof pos.z).toBe('number');
      expectTypeOf(pos).toMatchTypeOf<{ x: number; y: number; z: number }>();
    });

    it('WebXRQuaternion has exactly x, y, z, w number fields', () => {
      const orient: WebXRQuaternion = { x: 0, y: 0, z: 0, w: 1 };
      expect(typeof orient.x).toBe('number');
      expect(typeof orient.y).toBe('number');
      expect(typeof orient.z).toBe('number');
      expect(typeof orient.w).toBe('number');
      expectTypeOf(orient).toMatchTypeOf<{
        x: number;
        y: number;
        z: number;
        w: number;
      }>();
    });

    it('ARPose.position is WebXRVec3 and ARPose.orientation is WebXRQuaternion', () => {
      const pose: ARPose = {
        position: { x: 1, y: 2, z: 3 },
        orientation: { x: 0, y: 0.707, z: 0, w: 0.707 },
      };

      // Compile-time: these assignments prove the structural relationship
      const pos: WebXRVec3 = pose.position;
      const orient: WebXRQuaternion = pose.orientation;
      expect(pos.x).toBe(1);
      expect(orient.w).toBeCloseTo(0.707);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Readonly guards — Finding #6 (2026-03-05 code review)
  // ──────────────────────────────────────────────────────────────────────────

  describe('Readonly guards for pure-data interfaces', () => {
    /**
     * Why these tests matter:
     * All AR type interfaces are pure data — created once, never mutated.
     * Adding `readonly` prevents accidental mutation and signals intent.
     * These type-level guards ensure that T ≡ Readonly<T>, which holds
     * only when every field is already marked `readonly`.
     * Pattern: same as the GpsCoord readonly guard in geo-types.test.ts.
     */

    it('DepthPoint ≡ Readonly<DepthPoint>', () => {
      expectTypeOf<DepthPoint>().toEqualTypeOf<Readonly<DepthPoint>>();
    });

    it('WebXRVec3 ≡ Readonly<WebXRVec3>', () => {
      expectTypeOf<WebXRVec3>().toEqualTypeOf<Readonly<WebXRVec3>>();
    });

    it('WebXRQuaternion ≡ Readonly<WebXRQuaternion>', () => {
      expectTypeOf<WebXRQuaternion>().toEqualTypeOf<
        Readonly<WebXRQuaternion>
      >();
    });

    it('ARPose ≡ Readonly<ARPose>', () => {
      expectTypeOf<ARPose>().toEqualTypeOf<Readonly<ARPose>>();
    });

    // eslint-disable-next-line vitest/expect-expect -- type-level only: readonly enforced via @ts-expect-error at compile time
    it('ArPoseTuples fields are readonly', () => {
      // toEqualTypeOf<Readonly<T>> doesn't work with tuple-typed fields due
      // to a vitest/TS quirk with [unscopables]. Test readonly directly via
      // ts-expect-error — fails if fields are mutable (no error to expect).
      const pose: ArPoseTuples = {
        position: [1, 2, 3],
        rotation: [0, 0, 0, 1],
      };
      // @ts-expect-error — position should be readonly
      pose.position = [4, 5, 6];
      // @ts-expect-error — rotation should be readonly
      pose.rotation = [1, 0, 0, 0];
    });

    // eslint-disable-next-line vitest/expect-expect -- type-level only: readonly enforced via @ts-expect-error at compile time
    it('DepthSample fields are readonly', () => {
      const sample: DepthSample = {
        timestamp: 1000,
        cameraPos: [1, 2, 3],
        cameraRot: [0, 0, 0, 1],
        points: [],
      };
      // @ts-expect-error — timestamp should be readonly
      sample.timestamp = 2000;
      // @ts-expect-error — cameraPos should be readonly
      sample.cameraPos = [4, 5, 6];
      // @ts-expect-error — cameraRot should be readonly
      sample.cameraRot = [1, 0, 0, 0];
      // @ts-expect-error — points should be readonly
      sample.points = [];
    });
  });
});
