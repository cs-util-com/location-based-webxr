// Why this test matters: the per-commit fast gate runs only the unit tests
// related to a change in the changed package. A wrong plan silently
// under-tests a commit, so every rule that widens the set (a test that reads
// a file by name, a test that scans the whole tree) or falls back to the full
// suite (configs, data, deletions, setup files) is pinned here.
import { describe, it, expect } from 'vitest';
import { mergeImpact, planRelatedRun, relatedVitestArgs, upstreamChange } from './related-tests.mjs';

/** @param {Partial<Parameters<typeof planRelatedRun>[0]>} partial */
function plan(partial) {
  return planRelatedRun({ changed: [], deleted: [], testFiles: [], ...partial });
}

const PLAIN = { path: 'src/a.test.ts', text: "import { a } from './a';" };
const READER = {
  path: 'src/page.test.ts',
  text: "const html = readFileSync(resolve(root, 'index.html'), 'utf8');",
};
const SCANNER = {
  path: 'src/guard.test.ts',
  text: 'for (const f of readdirSync(SRC)) check(f);',
};

describe('planRelatedRun', () => {
  it('passes changed source files (tests included) to the related run', () => {
    expect(
      plan({ changed: ['src/a.ts', 'src/b.test.ts'], testFiles: [PLAIN] })
    ).toEqual({ mode: 'related', files: ['src/a.ts', 'src/b.test.ts'] });
  });

  it('adds every whole-tree scanner when a source file changed', () => {
    expect(
      plan({ changed: ['src/a.ts'], testFiles: [PLAIN, SCANNER] }).files
    ).toEqual(['src/a.ts', 'src/guard.test.ts']);
  });

  it('adds the tests that read a changed file by name', () => {
    expect(
      plan({ changed: ['index.html'], testFiles: [PLAIN, READER] })
    ).toEqual({ mode: 'related', files: ['index.html', 'src/page.test.ts'] });
  });

  it('adds a source-text reader of a changed module', () => {
    const sourceReader = {
      path: 'src/order.test.ts',
      text: "const s = readFileSync(new URL('./archive-open.ts', import.meta.url));",
    };
    expect(
      plan({ changed: ['src/archive-open.ts'], testFiles: [sourceReader] }).files
    ).toEqual(['src/archive-open.ts', 'src/order.test.ts']);
  });

  it('does not count a name mentioned without any file read', () => {
    const mention = { path: 'src/m.test.ts', text: '// see index.html' };
    expect(plan({ changed: ['index.html'], testFiles: [mention] }).files).toEqual([
      'index.html',
    ]);
  });

  it('ignores markdown and the generated timings file', () => {
    expect(
      plan({
        changed: ['src/a.ts.md', 'docs/notes.md', 'docs/test-timings.md', 'src/a.ts'],
      })
    ).toEqual({ mode: 'related', files: ['src/a.ts'] });
  });

  it('runs nothing for a change no unit test can read (a Playwright spec)', () => {
    expect(
      plan({ changed: ['playwright-tests/x.spec.js'], testFiles: [PLAIN, SCANNER] })
    ).toEqual({ mode: 'related', files: [] });
  });

  it('falls back to the full suite for configs, data and anything outside src', () => {
    for (const path of [
      'package.json',
      'vitest.config.ts',
      'vite.config.ts',
      'config/vitest.config.ts',
      'tsconfig.vitest.json',
      'src/fixtures/golden.json',
      'src/recording.zip',
      'scripts/build.mjs',
      'public/logo.svg',
    ]) {
      expect(plan({ changed: ['src/a.ts', path] }), path).toEqual({
        mode: 'full',
        reason: `${path} is not a source, style, page or Playwright file`,
      });
    }
  });

  it('falls back to the full suite for a setup file and for mocks', () => {
    expect(plan({ changed: ['src/test-setup.ts'] }).mode).toBe('full');
    expect(plan({ changed: ['src/__mocks__/three.ts'] }).mode).toBe('full');
  });

  it('falls back to the full suite when a file was deleted', () => {
    expect(plan({ changed: ['src/a.ts'], deleted: ['src/a.ts'] })).toEqual({
      mode: 'full',
      reason: 'src/a.ts was deleted or renamed',
    });
  });

  it('a deleted markdown file stays ignored', () => {
    expect(plan({ changed: ['src/a.ts.md'], deleted: ['src/a.ts.md'] })).toEqual({
      mode: 'related',
      files: [],
    });
  });

  it('falls back to the full suite above the file limit', () => {
    const changed = Array.from({ length: 4 }, (_, i) => `src/f${i}.ts`);
    expect(planRelatedRun({ changed, deleted: [], testFiles: [], maxFiles: 3 })).toEqual({
      mode: 'full',
      reason: '4 changed files (more than 3)',
    });
  });

  it('accepts backslash paths', () => {
    expect(plan({ changed: ['src\\editor\\a.ts'] }).files).toEqual(['src/editor/a.ts']);
  });
});

describe('relatedVitestArgs', () => {
  it('turns a full vitest run into a related run without coverage', () => {
    expect(
      relatedVitestArgs(
        ['vitest', 'run', '--coverage', '--config=config/vitest.config.ts'],
        ['src/a.ts']
      )
    ).toEqual(['related', '--run', '--config=config/vitest.config.ts', 'src/a.ts']);
  });

  it('refuses a command that is not a plain vitest run', () => {
    expect(relatedVitestArgs(['node', '--test', 'x.mjs'], ['src/a.ts'])).toBeNull();
    expect(relatedVitestArgs(['vitest'], ['src/a.ts'])).toBeNull();
  });
});

// Why: an app's tests can import an upstream workspace package's SOURCE
// (an alias, or exports that point at src), so a commit that edits the
// framework and an app at once must not run only the app's own slice: the
// app's tests of the framework module would be skipped. Any change in a
// package this one depends on, directly or through another, runs the full
// suite.
describe('upstreamChange', () => {
  const packages = [
    { dir: 'Fw', name: 'fw', deps: [] },
    { dir: 'Kit', name: 'kit', deps: ['fw'] },
    { dir: 'Tour', name: 'tour', deps: ['kit', 'three'] },
    { dir: 'Other', name: 'other', deps: [] },
  ];
  it('names a changed path in a direct or transitive upstream package', () => {
    expect(upstreamChange({ changed: ['Kit/src/a.ts'], packageDir: 'Tour', packages })).toBe('Kit/src/a.ts');
    expect(upstreamChange({ changed: ['Tour/src/b.ts', 'Fw/src/x.ts'], packageDir: 'Tour', packages })).toBe('Fw/src/x.ts');
  });
  it('ignores the package itself, unrelated packages, root files and dependents', () => {
    expect(
      upstreamChange({ changed: ['Tour/src/b.ts', 'Other/src/c.ts', 'scripts/s.mjs', 'Tour'], packageDir: 'Tour', packages })
    ).toBeNull();
    expect(upstreamChange({ changed: ['Tour/src/b.ts'], packageDir: 'Fw', packages })).toBeNull();
  });
  it('survives a dependency cycle and an unknown package', () => {
    const cyclic = [
      { dir: 'A', name: 'a', deps: ['b'] },
      { dir: 'B', name: 'b', deps: ['a'] },
    ];
    expect(upstreamChange({ changed: ['B/x.ts'], packageDir: 'A', packages: cyclic })).toBe('B/x.ts');
    expect(upstreamChange({ changed: ['B/x.ts'], packageDir: 'Nope', packages: cyclic })).toBeNull();
  });
});

// Why: a change outside this package (upstream, or a file one of its tests
// reads) used to run this package's whole suite. The import graph says which
// of its tests that change can reach, so the plan is the package's own
// related set plus those, unless a graph rule asks for the whole suite.
describe('mergeImpact', () => {
  const related = { mode: 'related', files: ['src/a.ts'] };
  const impact = {
    tests: ['Tour/src/x.test.ts', 'Other/src/y.test.ts', 'Tour/src/a.test.ts'],
    packages: ['Other', 'Tour'],
    fullSuite: [{ dir: 'Other', reason: 'Other/package.json is a manifest or tsconfig' }],
  };
  it('adds the reached tests of this package, package-relative', () => {
    expect(mergeImpact({ plan: related, impact, packageDir: 'Tour' })).toEqual({
      mode: 'related',
      files: ['src/a.test.ts', 'src/a.ts', 'src/x.test.ts'],
    });
  });
  it('runs the whole suite when the graph asks for it, saying why', () => {
    expect(mergeImpact({ plan: related, impact, packageDir: 'Other' })).toEqual({
      mode: 'full',
      reason: 'Other/package.json is a manifest or tsconfig',
    });
  });
  it('keeps a full own plan full', () => {
    const full = { mode: 'full', reason: 'x' };
    expect(mergeImpact({ plan: full, impact, packageDir: 'Tour' })).toBe(full);
  });
});
