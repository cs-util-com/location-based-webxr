/**
 * Why this test matters: a written `tour.json` is shared, signed and
 * compared byte for byte (a signature covers the exact bytes, and a tour
 * re-saved unchanged must not look edited). Renaming or reshaping the
 * reader's in-memory model must therefore never change one byte the
 * writer produces. The fixture holds generated version 3 manifests (steps
 * of every kind, items of every kind) with the SHA-256 of what the writer
 * produced for each when it was recorded; this asserts the writer still
 * produces exactly those bytes, and that a written file reads back and
 * writes again unchanged.
 *
 * Re-record the fixture only for a change that is MEANT to change the
 * written bytes, and say so in the change and in its `recordedWith`.
 *
 * What the cases do NOT hold: a station's description or card image
 * (minor 2), the tour details (description, cover, contact), `tourId` and
 * `needsNoGps`: neither the golden cases nor the generated round trip
 * below pin their bytes.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { tourManifestV3Arbitrary } from '../test-utils/tour-arbitraries';
import { parseTourManifest, serializeTourManifest } from './tour-manifest';

interface GoldenCase {
  readonly input: unknown;
  readonly sha256: string;
  readonly bytes: number;
}

const golden = JSON.parse(
  readFileSync(
    new URL('./fixtures/tour-v3-writer-golden.json', import.meta.url),
    'utf8'
  )
) as { cases: GoldenCase[] };

const sha256 = (text: string) =>
  createHash('sha256').update(text).digest('hex');

describe('the version 3 writer, byte for byte', () => {
  it('writes every recorded manifest exactly as it was recorded', () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(20);
    for (const c of golden.cases) {
      const written = serializeTourManifest(parseTourManifest(c.input));
      expect(written.length).toBe(c.bytes);
      expect(sha256(written)).toBe(c.sha256);
    }
  });

  it('a written file is a fixed point: read and written again, the same bytes', () => {
    fc.assert(
      fc.property(tourManifestV3Arbitrary, (record) => {
        const written = serializeTourManifest(parseTourManifest(record));
        // Every step is written with the file's key, never the reader's.
        const file = JSON.parse(written) as {
          stations: { steps: Record<string, unknown>[] }[];
        };
        const steps = file.stations.flatMap((s) => s.steps);
        expect(steps.filter((s) => !('block' in s) || 'action' in s)).toEqual(
          []
        );
        expect(
          serializeTourManifest(parseTourManifest(JSON.parse(written)))
        ).toBe(written);
      }),
      { numRuns: 150 }
    );
  });
});
