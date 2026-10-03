import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  mintQrAnchorFromSightings,
  QR_MINT_HEADING_UNCERTAIN_EXTENT_M,
} from './qr-anchor-mint.js';
import { parseQrLevel } from './qr-level.js';
import type { QrSighting } from './qr-sighting-accumulator.js';
import type { Matrix4 as AlignmentMatrix } from '../../core/index.js';

const IDENTITY: AlignmentMatrix = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
];
const ZERO = { lat: 48, lon: 11 };

const SIGHTING: QrSighting = {
  text: 'code',
  firstTimestamp: 0,
  lastTimestamp: 1000,
  detectionCount: 10,
  posesUsed: 8,
  odomPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
  translationSpreadM: 0.01,
  rotationSpreadDeg: 0.5,
  sizeM: 0.16,
  sizeSpreadM: 0.002,
  alignmentMatrix: IDENTITY,
  zero: ZERO,
  alignmentSampleCount: 8,
  segment: 0,
};

// Why this test matters (owner decision D31): the marker is a pure function
// of the extent the code was composed through, and it must reach the file.
// For ANY non-negative finite extent the written level says exactly
// "uncertain" below the threshold and "not uncertain" at or above it, and
// the level still parses, so no extent can produce a file a visitor cannot
// open.
describe('the uncertain-heading marker - property', () => {
  it('is extent < threshold for every finite non-negative extent, and the level stays valid', () => {
    fc.assert(
      fc.property(
        // `+ 0` folds -0 into 0, which JSON would do anyway.
        fc.double({ min: 0, max: 10_000, noNaN: true }).map((v) => v + 0),
        (gpsExtentM) => {
          const result = mintQrAnchorFromSightings({
            sightings: [SIGHTING],
            spansFrameChange: false,
            nowIso: '2026-10-02T12:00:00.000Z',
            currentAlignment: {
              alignmentMatrix: IDENTITY,
              zero: ZERO,
              alignmentSampleCount: 60,
              segment: 0,
              gpsExtentM,
            },
          });
          if (!result.ok || !result.level.ok) return false;
          const reparsed = parseQrLevel(JSON.parse(result.level.json));
          const quality = reparsed.qr.mintQuality;
          expect(quality?.headingUncertain).toBe(
            gpsExtentM < QR_MINT_HEADING_UNCERTAIN_EXTENT_M
          );
          expect(quality?.alignmentGpsExtentM).toBe(gpsExtentM);
          return true;
        }
      )
    );
  });
});
