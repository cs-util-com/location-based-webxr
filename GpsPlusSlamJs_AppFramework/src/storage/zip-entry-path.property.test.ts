/**
 * Why this test matters: the validator is a filter over arbitrary strings,
 * and the example tests only pin the shapes someone thought of. Generated
 * inputs pin the CONTRACT: a path built only from safe segments always
 * passes, any path that contains a forbidden shape always fails, and the
 * outcome never depends on the other paths in the list except through the
 * duplicate rule.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { assertSafeZipEntryPaths } from './zip-entry-path';

/** A segment that carries none of the forbidden shapes. */
const safeSegment = fc
  .stringMatching(/^[A-Za-z0-9_-]{1,12}$/)
  .filter((s) => s !== '.' && s !== '..');

const safePath = fc
  .array(safeSegment, { minLength: 1, maxLength: 4 })
  .map((segments) => segments.join('/'));

describe('assertSafeZipEntryPaths (properties)', () => {
  it('accepts every path made of safe segments, in any distinct set', () => {
    fc.assert(
      fc.property(fc.uniqueArray(safePath, { maxLength: 8 }), (paths) => {
        expect(() => assertSafeZipEntryPaths(paths)).not.toThrow();
      })
    );
  });

  it('rejects a safe path once any forbidden shape is spliced into it', () => {
    const poison = fc.constantFrom(
      (p: string) => `/${p}`,
      (p: string) => `${p}/`,
      (p: string) => `../${p}`,
      (p: string) => `${p}/..`,
      (p: string) => `./${p}`,
      (p: string) => `${p}//x`,
      (p: string) => p.replace('/', '\\') + '\\y',
      (p: string) => `C:${p}`,
      () => ''
    );
    fc.assert(
      fc.property(safePath, poison, (path, poisonFn) => {
        expect(() => assertSafeZipEntryPaths([poisonFn(path)])).toThrow();
      })
    );
  });

  it('rejects a list exactly when it repeats a path, however it is ordered', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(safePath, { minLength: 1, maxLength: 6 }),
        fc.nat(),
        (paths, seed) => {
          const duplicated = [...paths, paths[seed % paths.length] as string];
          const shuffled = [...duplicated].sort(
            (a, b) => a.length - b.length || a.localeCompare(b)
          );
          expect(() => assertSafeZipEntryPaths(shuffled)).toThrow(/duplicate/);
        }
      )
    );
  });
});
