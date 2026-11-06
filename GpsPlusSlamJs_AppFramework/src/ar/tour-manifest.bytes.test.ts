/**
 * Why this test matters: a written `tour.json` is shared, signed and
 * compared byte for byte (a signature covers the exact bytes, and a tour
 * re-saved unchanged must not look edited). Reshaping the reader's
 * in-memory model must therefore never change one byte the writer
 * produces. The fixture holds generated version 5 manifests (blocks of
 * every kind, free and in stories, choices and quizzes, and the tour's and
 * the stations' own fields; texts cut to 600 characters, which keeps the
 * fixture small) with the SHA-256 of what the writer produced for
 * each when it was recorded; this asserts the writer still produces
 * exactly those bytes (that a written file reads back and writes again
 * unchanged is a claim of the manifest property in
 * tour-manifest.property.test.ts).
 *
 * Re-record the fixture only for a change that is MEANT to change the
 * written bytes, and say so in the change and in its `recordedWith`.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseTourManifest, serializeTourManifest } from './tour-manifest';

interface GoldenCase {
  readonly input: unknown;
  readonly sha256: string;
  readonly bytes: number;
}

const golden = JSON.parse(
  readFileSync(
    new URL('./fixtures/tour-v5-writer-golden.json', import.meta.url),
    'utf8'
  )
) as { cases: GoldenCase[] };

const sha256 = (text: string) =>
  createHash('sha256').update(text).digest('hex');

describe('the version 5 writer, byte for byte', () => {
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
});
