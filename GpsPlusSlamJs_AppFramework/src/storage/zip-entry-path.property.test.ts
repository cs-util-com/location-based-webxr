/**
 * Why this test matters: the validator is a filter over arbitrary strings,
 * and the example tests only pin the shapes someone thought of. Generated
 * inputs pin the CONTRACT: a path built only from safe segments always
 * passes - and "safe" is wide (spaces, inner dots, non-ASCII letters,
 * punctuation), not the ASCII subset a lazy generator would choose - any
 * path that contains a forbidden shape always fails, and the outcome never
 * depends on the other paths in the list except through the duplicate rule.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { assertSafeZipEntryPaths } from './zip-entry-path';

/** A segment carrying none of the forbidden shapes: no `/`, no `\`, not
 *  `.` or `..`, non-empty. Everything else - spaces, dots inside, `#`,
 *  `?`, accented and CJK letters - is a legal file name. */
const safeSegment = fc
  .string({ minLength: 1, maxLength: 12, unit: 'grapheme' })
  .filter(
    (s) => !s.includes('/') && !s.includes('\\') && s !== '.' && s !== '..'
  );

const safePath = fc
  .array(safeSegment, { minLength: 1, maxLength: 4 })
  .map((segments) => segments.join('/'))
  // A first segment like `C:` is the drive-letter rule, not a safe shape.
  .filter((p) => !/^[a-zA-Z]:/.test(p));

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
      (p: string) => `${p}\\y`,
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
