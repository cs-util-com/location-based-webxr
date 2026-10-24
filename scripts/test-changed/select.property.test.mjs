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
          (p) =>
            !DIRS.includes(p.split('/')[0]) &&
            !p.startsWith('docs/') &&
            // The narrowed root classes (select.mjs ROOT_NARROW).
            !p.toLowerCase().endsWith('.md') &&
            !p.startsWith('tests/repo-config/') &&
            p !== 'knip.json'
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

  // Why: narrowing may only ADD root checks and drop doc-only packages; it
  // must never take away a package that a code change selected, nor select
  // one that nothing selected.
  const narrowedRootArb = fc.constantFrom(
    'README.md',
    'docs/notes.md',
    'tests/repo-config/a.test.js',
    'tests/repo-config/helper.js',
    'knip.json',
    '.github/workflows/ci.yml',
    '.vscode/settings.json'
  );
  const docArb = fc
    .tuple(
      fc.constantFrom(...DIRS),
      fc.constantFrom('README.md', 'CHANGELOG.md', 'src/a.ts.md', 'docs/x.md')
    )
    .map(([dir, rest]) => `${dir}/${rest}`);

  it('narrowed root paths never change which packages run in full', () => {
    fc.assert(
      fc.property(
        fc.array(packagePathArb.filter((p) => !p.endsWith('.md')), { maxLength: 10 }),
        fc.array(narrowedRootArb, { minLength: 1, maxLength: 5 }),
        (packagePaths, rootPaths) => {
          const without = selectPackages({
            trackedChanges: packagePaths,
            untracked: [],
            packageDirs: DIRS,
          });
          const withRoot = selectPackages({
            trackedChanges: [...packagePaths, ...rootPaths],
            untracked: [],
            packageDirs: DIRS,
          });
          expect(withRoot.mode).toBe('packages');
          if (without.mode === 'packages' && withRoot.mode === 'packages') {
            expect(withRoot.packages).toEqual(without.packages);
            expect(withRoot.rootFiles).toEqual([...new Set(rootPaths)].sort());
          }
        }
      )
    );
  });

  it('a doc-only file never selects its package, and is never listed beside a full gate', () => {
    fc.assert(
      fc.property(
        fc.array(packagePathArb.filter((p) => !p.endsWith('.md')), { maxLength: 10 }),
        fc.array(docArb, { minLength: 1, maxLength: 5 }),
        (codePaths, docPaths) => {
          const result = selectPackages({
            trackedChanges: [...codePaths, ...docPaths],
            untracked: [],
            packageDirs: DIRS,
          });
          if (result.mode !== 'packages') throw new Error('unexpected full cascade');
          const codeDirs = new Set(codePaths.map((p) => p.split('/')[0]));
          expect(result.packages).toEqual([...codeDirs].sort());
          for (const doc of result.docsOnly ?? []) {
            expect(codeDirs.has(doc.split('/')[0])).toBe(false);
          }
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
