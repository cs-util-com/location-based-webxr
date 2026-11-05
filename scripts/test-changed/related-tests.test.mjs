// Why this test matters: the per-commit fast gate runs only the unit tests
// related to a change in the changed package. A wrong plan silently
// under-tests a commit, so every rule that widens the set (a test that reads
// a file by name, a test that scans the whole tree) or falls back to the full
// suite (configs, data, deletions, setup files) is pinned here.
import { describe, it, expect } from 'vitest';
import { planRelatedRun, relatedVitestArgs } from './related-tests.mjs';

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
