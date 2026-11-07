// Why this test matters: the per-commit fast gate picks the unit tests a
// change can reach across packages from this graph instead of running every
// dependent's whole suite. A missing edge silently under-tests a commit, so
// every kind of edge (relative and package imports through `exports`,
// wildcard subpaths, globs, template prefixes, file readers, scanners) and
// every fallback to a full suite is pinned here on a small in-memory tree.
import { describe, it, expect } from 'vitest';
import { buildImpactGraph, impactOf } from './impact-graph.mjs';

const PACKAGES = [
  {
    dir: 'Fw',
    name: 'fw',
    deps: [],
    exports: { '.': { import: './dist/index.js' }, './utils/*': './dist/utils/*.js' },
  },
  { dir: 'Tour', name: 'tour', deps: ['fw'], exports: undefined },
  { dir: 'Other', name: 'other', deps: [], exports: undefined },
];

/** @type {Record<string, string>} */
const TEXTS = {
  'Fw/src/index.ts': "export * from './a';",
  'Fw/src/a.ts': 'export const a = 1;',
  'Fw/src/a.test.ts': "import { a } from './a';",
  'Fw/src/utils/u.ts': 'export const u = 1;',
  'Tour/src/view.ts': "import { a } from 'fw';",
  'Tour/src/view.test.ts': "import './view';",
  'Tour/src/u.test.ts': "import { u } from 'fw/utils/u';",
  'Tour/src/page.test.ts': "const html = readFileSync(resolve(root, 'index.html'), 'utf8');",
  'Tour/src/scan.test.ts': 'for (const f of readdirSync(SRC)) check(f);',
  'Tour/src/fw-source.test.ts': "const s = readFileSync('../Fw/src/a.ts', 'utf8');",
  'Tour/src/items.test.ts': "const all = import.meta.glob('./items/*.ts');",
  'Tour/src/items/k.ts': 'export const k = 1;',
  'Tour/src/kinds.test.ts': 'const m = await import(`./kinds/${name}.js`);',
  'Tour/src/kinds/q.ts': 'export const q = 1;',
  'Tour/src/mocked.test.ts': "vi.mock('./items/k', () => ({}));",
  'Tour/vitest.config.ts': "import { u } from 'fw/utils/u';",
  'Other/src/o.test.ts': "const s = readFileSync('a.ts', 'utf8');",
  'Other/src/test-setup.ts': '',
};
const FILES = [...Object.keys(TEXTS), 'Tour/index.html', 'Fw/package.json', 'Fw/README.md'];

const graph = buildImpactGraph({
  packages: PACKAGES,
  files: FILES,
  texts: new Map(Object.entries(TEXTS)),
});

/** @param {string[]} changed */
const impact = (changed) => impactOf(graph, changed);

describe('impactOf: edges', () => {
  it('follows a package import through its exports to the source, across packages', () => {
    const r = impact(['Fw/src/a.ts']);
    expect(r.tests).toContain('Fw/src/a.test.ts');
    expect(r.tests).toContain('Tour/src/view.test.ts');
    expect(r.tests).not.toContain('Tour/src/u.test.ts');
    expect(r.packages).toEqual(['Fw', 'Tour']);
  });

  it('resolves a wildcard export subpath', () => {
    expect(impact(['Fw/src/utils/u.ts']).tests).toContain('Tour/src/u.test.ts');
  });

  it('a test-only change reaches only that test and runs no other package', () => {
    expect(impact(['Fw/src/a.test.ts'])).toEqual({
      tests: ['Fw/src/a.test.ts'],
      packages: ['Fw'],
      fullSuite: [],
    });
  });

  it('reaches the tests behind an import.meta.glob, a template import and a vi.mock', () => {
    expect(impact(['Tour/src/items/k.ts']).tests).toEqual(
      expect.arrayContaining(['Tour/src/items.test.ts', 'Tour/src/mocked.test.ts'])
    );
    expect(impact(['Tour/src/kinds/q.ts']).tests).toContain('Tour/src/kinds.test.ts');
  });

  it('a glob depends on its own folder only, not on its siblings', () => {
    expect(impact(['Tour/src/view.ts']).tests).not.toContain('Tour/src/items.test.ts');
  });

  it('reaches a test that reads a changed file of its own package by name', () => {
    expect(impact(['Tour/index.html']).tests).toEqual(['Tour/src/page.test.ts']);
  });

  it('a reader in another package counts only when it names that package', () => {
    const r = impact(['Fw/src/a.ts']);
    expect(r.tests).toContain('Tour/src/fw-source.test.ts');
    expect(r.tests).not.toContain('Other/src/o.test.ts');
  });

  it('reaches a whole-tree scanner of a package whose source changed, not of another', () => {
    expect(impact(['Tour/src/items/k.ts']).tests).toContain('Tour/src/scan.test.ts');
    expect(impact(['Fw/src/a.ts']).tests).not.toContain('Tour/src/scan.test.ts');
  });

  it('markdown reaches nothing', () => {
    expect(impact(['Fw/README.md', 'Fw/src/a.ts.md'])).toEqual({ tests: [], packages: [], fullSuite: [] });
  });

  it('accepts backslash paths', () => {
    expect(impact(['Fw\\src\\a.test.ts']).tests).toEqual(['Fw/src/a.test.ts']);
  });
});

describe('impactOf: fallbacks to a full suite', () => {
  /** @param {string[]} changed */
  const full = (changed) => impact(changed).fullSuite.map((f) => f.dir);

  it('a deleted file runs its package and its dependents in full', () => {
    expect(full(['Fw/src/gone.ts'])).toEqual(['Fw', 'Tour']);
    expect(impact(['Fw/src/gone.ts']).fullSuite[0].reason).toMatch(/deleted/);
  });

  it('a manifest, a tsconfig, a vite or vitest config, a setup file or a mock runs its package and dependents in full', () => {
    for (const path of [
      'Fw/package.json',
      'Fw/tsconfig.json',
      'Fw/vitest.config.ts',
      'Fw/config/vite.config.ts',
      'Fw/src/test-setup.ts',
      'Fw/src/__mocks__/three.ts',
    ]) {
      expect(full([path]), path).toEqual(['Fw', 'Tour']);
    }
    expect(full(['Other/src/test-setup.ts'])).toEqual(['Other']);
  });

  it('a config reached through an import runs that package in full', () => {
    const r = impact(['Fw/src/utils/u.ts']);
    expect(r.fullSuite).toEqual([
      { dir: 'Tour', reason: 'Tour/vitest.config.ts imports the change' },
    ]);
  });

  it('a module whose name merely ends in setup is not a setup file', () => {
    const g = buildImpactGraph({
      packages: PACKAGES,
      files: ['Tour/src/creator-setup.ts', 'Tour/src/creator-setup.test.ts'],
      texts: new Map([
        ['Tour/src/creator-setup.ts', ''],
        ['Tour/src/creator-setup.test.ts', "import './creator-setup';"],
      ]),
    });
    expect(impactOf(g, ['Tour/src/creator-setup.ts'])).toEqual({
      tests: ['Tour/src/creator-setup.test.ts'],
      packages: ['Tour'],
      fullSuite: [],
    });
  });

  it('a file a config names by a path string (setupFiles) runs that package in full', () => {
    const g = buildImpactGraph({
      packages: PACKAGES,
      files: ['Tour/config/vitest.config.ts', 'scripts/time-limit.mjs', 'Tour/src/hooks/before.ts'],
      texts: new Map([
        // Relative to the config, or to the package root as vitest's root resolves it.
        ['Tour/config/vitest.config.ts', "export default { test: { setupFiles: ['../../scripts/time-limit.mjs', 'src/hooks/before.ts'] } };"],
        ['scripts/time-limit.mjs', ''],
        ['Tour/src/hooks/before.ts', ''],
      ]),
    });
    for (const changed of ['scripts/time-limit.mjs', 'Tour/src/hooks/before.ts']) {
      expect(impactOf(g, [changed]).fullSuite, changed).toEqual([
        { dir: 'Tour', reason: 'Tour/config/vitest.config.ts imports the change' },
      ]);
    }
  });

  it('a deleted markdown file stays ignored', () => {
    expect(full(['Fw/docs/gone.md'])).toEqual([]);
  });
});
