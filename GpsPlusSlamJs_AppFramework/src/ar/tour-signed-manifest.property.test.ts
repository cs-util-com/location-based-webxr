/**
 * Why this test matters: the tier-1 check decides whether an archive is
 * exactly the list its author signed. Its answer must not depend on things
 * a re-zip changes harmlessly - the order of entries, a leading `./`,
 * `./` segments inside a name - and it must never accept the same file
 * twice, under any spelling, or a file more or less than listed (tour kit
 * plan K1, §8 D4). Hand-picked cases cannot cover the spellings; these
 * properties generate them.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  checkEntriesAgainstManifest,
  parseSignedTourManifest,
  TourIntegrityError,
  type SignedTourManifest,
} from './tour-signed-manifest';

const segment = fc.stringMatching(/^[a-z0-9_-]{1,8}$/);
const path = fc
  .array(segment, { minLength: 1, maxLength: 3 })
  .map((parts) => parts.join('/'))
  .filter((p) => p !== 'manifest.json' && p !== 'manifest.sig.json');

/** A manifest of 1-8 distinct files, with the matching entry list. Paths
 *  are prefix-free (no file is also a folder of another), as in a zip. */
const listing = fc
  .uniqueArray(fc.record({ path, size: fc.nat({ max: 1_000_000 }) }), {
    minLength: 1,
    maxLength: 8,
    selector: (f) => f.path,
  })
  .filter((files) =>
    files.every((a) =>
      files.every((b) => a === b || !b.path.startsWith(`${a.path}/`))
    )
  )
  .map((files) => {
    const manifest: SignedTourManifest = parseSignedTourManifest(
      JSON.stringify({
        formatVersion: 1,
        seriesId: 'K7fQ2mX9pL4sT8vB1nR6wA',
        version: 1,
        createdAt: '2026-10-04T00:00:00.000Z',
        files: Object.fromEntries(
          files.map((f) => [f.path, { sha256: 'a'.repeat(64), size: f.size }])
        ),
      })
    );
    const entries = files.map((f) => ({
      filename: f.path,
      uncompressedSize: f.size,
    }));
    return { manifest, entries };
  });

/** Respell a path: a leading `./` and `./` segments, as re-zips write. */
const respell = (p: string, how: number): string => {
  const parts = p.split('/');
  const dotted = parts.flatMap((s, i) => ((how >> i) & 1 ? ['.', s] : [s]));
  return (how & 8 ? './' : '') + dotted.join('/');
};

function kindOf(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (err) {
    return err instanceof TourIntegrityError ? err.kind : 'other';
  }
}

const recordsOf = (m: Map<string, unknown>) => [...m.values()];

describe('checkEntriesAgainstManifest (properties)', () => {
  it('accepts the exact listing in any order, under any ./ spelling, with the same records', () => {
    fc.assert(
      fc.property(
        listing,
        fc.array(fc.nat({ max: 15 }), { minLength: 8, maxLength: 8 }),
        fc.integer(),
        ({ manifest, entries }, spellings, seed) => {
          const plain = checkEntriesAgainstManifest(
            entries,
            manifest,
            'manifest.json'
          );
          const shuffled = [...entries]
            .map((e, i) => ({
              filename: respell(e.filename, spellings[i]!),
              uncompressedSize: e.uncompressedSize,
            }))
            .sort(
              (a, b) =>
                ((a.filename.length * seed) % 7) -
                ((b.filename.length * seed) % 7)
            );
          const other = checkEntriesAgainstManifest(
            shuffled,
            manifest,
            './manifest.json'
          );
          expect(new Set(recordsOf(other))).toEqual(new Set(recordsOf(plain)));
          expect(other.size).toBe(plain.size);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('refuses any entry repeated, under any spelling', () => {
    fc.assert(
      fc.property(
        listing,
        fc.nat(),
        fc.nat({ max: 15 }),
        ({ manifest, entries }, pick, how) => {
          const twice = entries[pick % entries.length]!;
          const doubled = [
            ...entries,
            { ...twice, filename: respell(twice.filename, how) },
          ];
          expect(
            kindOf(() =>
              checkEntriesAgainstManifest(doubled, manifest, 'manifest.json')
            )
          ).toBe('duplicate-name');
        }
      ),
      { numRuns: 200 }
    );
  });

  it('refuses one file more, one file fewer, or one size changed', () => {
    fc.assert(
      fc.property(
        listing,
        fc.nat(),
        segment,
        ({ manifest, entries }, pick, extra) => {
          const i = pick % entries.length;
          const fewer = entries.filter((_, j) => j !== i);
          const resized = entries.map((e, j) =>
            j === i ? { ...e, uncompressedSize: e.uncompressedSize + 1 } : e
          );
          const more = [
            ...entries,
            { filename: `zz-extra/${extra}.bin`, uncompressedSize: 1 },
          ];
          const check = (list: typeof entries) =>
            kindOf(() =>
              checkEntriesAgainstManifest(list, manifest, 'manifest.json')
            );
          expect(check(fewer)).toBe('missing-file');
          expect(check(resized)).toBe('size-mismatch');
          expect(check(more)).toBe('unlisted-file');
        }
      ),
      { numRuns: 200 }
    );
  });
});
