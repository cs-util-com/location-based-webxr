/**
 * Why this test matters: a written `tour.json` is shared, signed and
 * compared byte for byte (a signature covers the exact bytes, and a tour
 * re-saved unchanged must not look edited). Reshaping the reader's
 * in-memory model must therefore never change one byte the writer
 * produces. The fixture holds generated version 4 manifests (blocks of
 * every kind, free and shown, steps of every kind, and the tour's and the
 * stations' own fields; texts cut to 600 characters, which keeps the
 * fixture small) with the SHA-256 of what the writer produced for
 * each when it was recorded; this asserts the writer still produces
 * exactly those bytes, and that a written file reads back and writes
 * again unchanged.
 *
 * Re-record the fixture only for a change that is MEANT to change the
 * written bytes, and say so in the change and in its `recordedWith`.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { tourManifestArbitrary } from '../test-utils/tour-arbitraries';
import { parseTourManifest, serializeTourManifest } from './tour-manifest';

interface GoldenCase {
  readonly input: unknown;
  readonly sha256: string;
  readonly bytes: number;
}

const golden = JSON.parse(
  readFileSync(
    new URL('./fixtures/tour-v4-writer-golden.json', import.meta.url),
    'utf8'
  )
) as { cases: GoldenCase[] };

const sha256 = (text: string) =>
  createHash('sha256').update(text).digest('hex');

describe('the version 4 writer, byte for byte', () => {
  it('writes every recorded manifest exactly as it was recorded', () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(20);
    for (const c of golden.cases) {
      const written = serializeTourManifest(parseTourManifest(c.input));
      expect(written.length).toBe(c.bytes);
      expect(sha256(written)).toBe(c.sha256);
    }
  });

  it('the recorded cases hold the fields a generated tour lacks: details, a tour id, no GPS, station descriptions and card images', () => {
    // Why: a case set without them would pin none of their bytes.
    const inputs = golden.cases.map((c) => c.input as Record<string, unknown>);
    for (const key of [
      'description',
      'cover',
      'contact',
      'tourId',
      'needsNoGps',
    ]) {
      expect(
        inputs.some((i) => key in i),
        key
      ).toBe(true);
    }
    const stations = inputs.flatMap(
      (i) => i.stations as Record<string, unknown>[]
    );
    expect(stations.some((s) => 'description' in s)).toBe(true);
    expect(stations.some((s) => 'image' in s)).toBe(true);
  });

  it('a written file is a fixed point: read and written again, the same bytes', () => {
    fc.assert(
      fc.property(tourManifestArbitrary(), (record) => {
        const written = serializeTourManifest(parseTourManifest(record));
        // Every step is written under its one key.
        const file = JSON.parse(written) as {
          stations: { steps: Record<string, unknown>[] }[];
        };
        const steps = file.stations.flatMap((s) => s.steps);
        expect(steps.filter((s) => !('action' in s) || 'block' in s)).toEqual(
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
