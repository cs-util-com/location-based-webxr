import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  DEPTH_CONSTRAINTS,
  FRAME_TILE_DISPLAY_CONSTRAINTS,
  IMAGE_CONSTRAINTS,
  MOTION_FILTER_CONSTRAINTS,
  OCCUPANCY_CONSTRAINTS,
  QR_CONSTRAINTS,
  QUALITY_FILTER_CONSTRAINTS,
  validateRecordingOptions,
  type RecordingOptionsInput,
} from './recording-options';

/**
 * Property-based robustness tests for the recording-options validators.
 *
 * Why this test matters: the validators' single job is to turn UNTRUSTED
 * persisted/external input (localStorage survives app versions, users, and
 * corruption) into a safe, fully-populated options object. The example-based
 * suite pins known cases; these properties pin the CONTRACT for every input
 * the generators can produce:
 *
 *   1. Never throws — arbitrary junk in any field yields a valid object.
 *   2. Constraint conformance — every numeric field lands inside its
 *      published CONSTRAINTS window (NaN/Infinity/strings can never leak).
 *   3. Idempotence — validating an already-validated object changes nothing.
 *   4. Serialization stability — a validated object survives
 *      JSON round-trip + re-validation byte-identically (the persisted-JSON
 *      key-order guarantee the field specs document).
 */

/** Arbitrary junk for a single field (includes valid-looking values). */
const junk = fc.oneof(
  fc.anything(),
  fc.double({ noNaN: false }),
  fc.boolean(),
  fc.string()
);

/** A group object mixing junk into the group's REAL field names. */
function groupArb(fields: readonly string[]) {
  return fc.oneof(
    fc.constant(undefined),
    fc.record(Object.fromEntries(fields.map((f) => [f, junk])), {
      requiredKeys: [],
    })
  );
}

const inputArb = fc.record(
  {
    depth: groupArb(['enabled', 'intervalMs', 'gridSize', 'rgb']),
    images: groupArb([
      'enabled',
      'intervalMs',
      'quality',
      'resolutionDivisor',
      'motionFilter',
      'qualityFilter',
    ]),
    arCrashIsolation: groupArb(['enableCameraAccess', 'enableDomOverlay']),
    occupancy: groupArb([
      'cellSizeM',
      'minConfidence',
      'persistentOcclusion',
      'liveOcclusion',
      'occluderDebugStyle',
      'occluderMeshMode',
      'occluderRadiusM',
      // Legacy migration inputs must be junk-tolerant too.
      'occlusionMeshEnabled',
      'occluderDebugViz',
    ]),
    frameTileDisplay: groupArb(['divisor', 'maxTiles']),
    visualization: groupArb([
      'frameTiles',
      'occupancyCubes',
      'gpsAlignmentMarkers',
      'compassCubes',
      'headingUpMap',
      'statsOverlay',
    ]),
    qr: groupArb(['enabled', 'intervalMs', 'captureSize']),
    compassDebug: groupArb([
      'coldStartOverride',
      'rotationPrior',
      'webXRConsistency',
    ]),
    loopClosureDebug: groupArb(['detectorEnabled']),
  },
  { requiredKeys: [] }
);

/** Assert `value` is a finite number inside [min, max]. */
function expectInWindow(
  value: number,
  window: { readonly min: number; readonly max: number }
): void {
  expect(Number.isFinite(value)).toBe(true);
  expect(value).toBeGreaterThanOrEqual(window.min);
  expect(value).toBeLessThanOrEqual(window.max);
}

describe('recording-options — validation properties', () => {
  it('never throws and every numeric field lands inside its constraints window', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const validated = validateRecordingOptions(input);

        expectInWindow(
          validated.depth.intervalMs,
          DEPTH_CONSTRAINTS.intervalMs
        );
        expectInWindow(validated.depth.gridSize, DEPTH_CONSTRAINTS.gridSize);
        expect(Number.isInteger(validated.depth.gridSize)).toBe(true);

        expectInWindow(
          validated.images.intervalMs,
          IMAGE_CONSTRAINTS.intervalMs
        );
        expectInWindow(validated.images.quality, IMAGE_CONSTRAINTS.quality);
        expectInWindow(
          validated.images.resolutionDivisor,
          IMAGE_CONSTRAINTS.resolutionDivisor
        );
        expectInWindow(
          validated.images.motionFilter.maxWaitMs,
          MOTION_FILTER_CONSTRAINTS.maxWaitMs
        );
        expectInWindow(
          validated.images.qualityFilter.blurRelativeThreshold,
          QUALITY_FILTER_CONSTRAINTS.blurRelativeThreshold
        );

        expectInWindow(
          validated.occupancy.cellSizeM,
          OCCUPANCY_CONSTRAINTS.cellSizeM
        );
        expectInWindow(
          validated.occupancy.minConfidence,
          OCCUPANCY_CONSTRAINTS.minConfidence
        );
        expect(Number.isInteger(validated.occupancy.minConfidence)).toBe(true);
        expectInWindow(
          validated.occupancy.occluderRadiusM,
          OCCUPANCY_CONSTRAINTS.occluderRadiusM
        );

        expectInWindow(
          validated.frameTileDisplay.divisor,
          FRAME_TILE_DISPLAY_CONSTRAINTS.divisor
        );
        expect(Number.isInteger(validated.frameTileDisplay.divisor)).toBe(true);
        expectInWindow(
          validated.frameTileDisplay.maxTiles,
          FRAME_TILE_DISPLAY_CONSTRAINTS.maxTiles
        );

        expectInWindow(validated.qr.intervalMs, QR_CONSTRAINTS.intervalMs);
        expectInWindow(validated.qr.captureSize, QR_CONSTRAINTS.captureSize);
      }),
      { numRuns: 200 }
    );
  });

  it('is idempotent and serialization-stable: validate(validate(x)) round-trips byte-identically', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const once = validateRecordingOptions(input);
        const twice = validateRecordingOptions(once);
        expect(twice).toEqual(once);
        // Byte-stability of the persisted JSON across save→load→validate:
        // key ORDER must be stable too, not just deep equality — this is the
        // guarantee the field-spec declaration order carries.
        expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
        const reloaded = validateRecordingOptions(
          JSON.parse(JSON.stringify(once)) as RecordingOptionsInput
        );
        expect(JSON.stringify(reloaded)).toBe(JSON.stringify(once));
      }),
      { numRuns: 200 }
    );
  });
});
