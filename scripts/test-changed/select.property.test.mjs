// Why this test matters: the unit cases pin known guard rails; these
// properties pin the SHAPE of the decision for arbitrary inputs — the
// selection must never invent packages, never let an out-of-package path
// slip through as a package run, and must be insensitive to path order.
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { selectPackages } from './select.mjs';

const DIRS = ['PkgA', 'PkgB', 'PkgC'];

const packagePathArb = fc
  .tuple(
    fc.constantFrom(...DIRS),
    fc.stringMatching(/^[a-z][a-z0-9-]{0,10}(\/[a-z][a-z0-9.-]{0,10}){0,3}$/)
  )
  .map(([dir, rest]) => `${dir}/${rest}`);

const rootPathArb = fc.stringMatching(
  /^[a-w][a-z0-9.-]{0,12}(\/[a-z][a-z0-9.-]{0,10}){0,2}$/
);

describe('selectPackages properties', () => {
  it('only ever selects known package dirs, regardless of input', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(packagePathArb, rootPathArb), { maxLength: 20 }),
        fc.array(fc.oneof(packagePathArb, rootPathArb), { maxLength: 20 }),
        (trackedChanges, untracked) => {
          const result = selectPackages({
            trackedChanges,
            untracked,
            packageDirs: DIRS,
          });
          if (result.mode === 'packages') {
            for (const pkg of result.packages) {
              expect(DIRS).toContain(pkg);
            }
          }
        }
      )
    );
  });

  it('package-only inputs never trigger the full cascade', () => {
    fc.assert(
      fc.property(
        fc.array(packagePathArb, { maxLength: 20 }),
        (trackedChanges) => {
          const result = selectPackages({
            trackedChanges,
            untracked: [],
            packageDirs: DIRS,
          });
          expect(result.mode).toBe('packages');
        }
      )
    );
  });

  it('any non-package path forces the full cascade', () => {
    fc.assert(
      fc.property(
        fc.array(packagePathArb, { maxLength: 10 }),
        rootPathArb.filter(
          (p) => !DIRS.includes(p.split('/')[0]) && !p.startsWith('docs/')
        ),
        (packagePaths, rootPath) => {
          const result = selectPackages({
            trackedChanges: [...packagePaths, rootPath],
            untracked: [],
            packageDirs: DIRS,
          });
          expect(result.mode).toBe('all');
        }
      )
    );
  });

  it('is insensitive to input order', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(packagePathArb, rootPathArb), { maxLength: 15 }),
        (paths) => {
          const forward = selectPackages({
            trackedChanges: paths,
            untracked: [],
            packageDirs: DIRS,
          });
          const reversed = selectPackages({
            trackedChanges: [...paths].reverse(),
            untracked: [],
            packageDirs: DIRS,
          });
          expect(forward.mode).toBe(reversed.mode);
          if (forward.mode === 'packages' && reversed.mode === 'packages') {
            expect(forward.packages).toEqual(reversed.packages);
          }
        }
      )
    );
  });
});
