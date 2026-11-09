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
  'Fw/src/prov.test.ts': "const p = readFileSync(join(DIR, 'PROVENANCE.md'), 'utf8');",
};
const FILES = [...Object.keys(TEXTS), 'Tour/index.html', 'Fw/package.json', 'Fw/README.md', 'Fw/fixtures/PROVENANCE.md'];
// Present, so the fallback tests below see each rule, not 'deleted'.
const RULE_FILES = ['Fw/tsconfig.json', 'Fw/vitest.config.ts', 'Fw/config/vite.config.ts', 'Fw/src/test-setup.ts', 'Fw/src/__mocks__/three.ts', 'Fw/src/types/global.d.ts', 'Fw/tsdown.config.ts', 'Fw/config/rollup.config.mjs'];

const graph = buildImpactGraph({
  packages: PACKAGES,
  files: [...FILES, ...RULE_FILES],
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

  it('markdown that no test reads reaches nothing', () => {
    expect(impact(['Fw/README.md', 'Fw/src/a.ts.md'])).toEqual({ tests: [], packages: [], fullSuite: [] });
  });

  // Why: a unit test can read markdown as data (the design system's terrain
  // fixtures test reads fixtures/PROVENANCE.md); dropping every .md missed it.
  it('reaches a test that reads a changed markdown file by name', () => {
    expect(impact(['Fw/fixtures/PROVENANCE.md'])).toEqual({
      tests: ['Fw/src/prov.test.ts'],
      packages: ['Fw'],
      fullSuite: [],
    });
  });

  // Why: the Recorder's vitest include lists src/**/*.spec.ts. A spec under
  // src is a unit test; one elsewhere is a Playwright spec (the design
  // system keeps its browser specs beside its pages).
  it('counts a *.spec file under src as a unit test, and a spec elsewhere as none', () => {
    const g = buildImpactGraph({
      packages: PACKAGES,
      files: ['Tour/src/x.ts', 'Tour/src/x.spec.ts', 'Tour/pages/x.spec.mjs'],
      texts: new Map([
        ['Tour/src/x.ts', ''],
        ['Tour/src/x.spec.ts', "import './x';"],
        ['Tour/pages/x.spec.mjs', "import '../src/x';"],
      ]),
    });
    expect(impactOf(g, ['Tour/src/x.ts']).tests).toEqual(['Tour/src/x.spec.ts']);
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
      // Ambient declarations reach every file of a program without an import.
      'Fw/src/types/global.d.ts',
      // The build config shapes dist, which the dependents type-check against.
      'Fw/tsdown.config.ts',
      'Fw/config/rollup.config.mjs',
    ]) {
      expect(full([path]), path).toEqual(['Fw', 'Tour']);
      expect(impact([path]).fullSuite[0].reason, path).not.toMatch(/deleted/);
    }
    expect(full(['Other/src/test-setup.ts'])).toEqual(['Other']);
  });

  it('a config reached through an import runs that package in full', () => {
    const r = impact(['Fw/src/utils/u.ts']);
    expect(r.fullSuite).toEqual([
      { dir: 'Tour', reason: 'Tour/vitest.config.ts imports the change' },
    ]);
  });

  // Why: the Recorder's and the globe's vitest configs alias the framework
  // package to its src folder. Read as an import, that alias made each config
  // import the framework index, so any change that reached the index ran both
  // packages' whole suites (a change to the Osm index reached 12 packages).
  // An alias says how the package's own files resolve a specifier; it loads
  // nothing by itself.
  it('a config alias is a resolution rule for its package, not an import of the config', () => {
    const g = buildImpactGraph({
      packages: [...PACKAGES, { dir: 'Rec', name: 'rec', deps: ['fw'], exports: undefined }],
      files: [...FILES, 'Rec/config/vitest.config.ts', 'Rec/src/r.ts', 'Rec/src/r.test.ts', 'Rec/src/s.test.ts', 'Other/src/shared/k.ts'],
      texts: new Map([
        ...Object.entries(TEXTS),
        [
          'Rec/config/vitest.config.ts',
          "export default defineConfig({ resolve: { alias: {\n  'fw': fileURLToPath(new URL('../../Fw/src', import.meta.url)),\n  \"shared\": fileURLToPath(\n    new URL(\"../../Other/src/shared\", import.meta.url)\n  ),\n} } });",
        ],
        ['Rec/src/r.ts', "import { a } from 'fw';"],
        ['Rec/src/r.test.ts', "import './r';"],
        // `shared` is no workspace package: only the alias resolves it.
        ['Rec/src/s.test.ts', "import { k } from 'shared/k';"],
        ['Other/src/shared/k.ts', ''],
      ]),
    });
    const r = impactOf(g, ['Fw/src/a.ts']);
    expect(r.fullSuite).toEqual([]);
    expect(r.tests).toContain('Rec/src/r.test.ts');
    expect(r.tests).not.toContain('Rec/src/s.test.ts');
    expect(impactOf(g, ['Other/src/shared/k.ts'])).toMatchObject({ tests: ['Rec/src/s.test.ts'], fullSuite: [] });
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

  // Why: the Recorder's coverage exclude names 'src/main.ts', which imports
  // the framework index; read as a loaded file it ran the Recorder's whole
  // suite on every change behind that index. Only setupFiles and globalSetup
  // load a file by its path.
  it('a path a config names outside setupFiles and globalSetup (a coverage exclude) loads nothing', () => {
    const g = buildImpactGraph({
      packages: PACKAGES,
      files: ['Tour/config/vitest.config.ts', 'Tour/src/main.ts', 'Tour/src/global.ts', 'Tour/src/main.test.ts'],
      texts: new Map([
        [
          'Tour/config/vitest.config.ts',
          "export default { test: { globalSetup: 'src/global.ts', coverage: { exclude: ['src/**/*.test.ts', 'src/main.ts'] } } };",
        ],
        ['Tour/src/main.ts', ''],
        ['Tour/src/global.ts', ''],
        ['Tour/src/main.test.ts', "import './main';"],
      ]),
    });
    expect(impactOf(g, ['Tour/src/main.ts'])).toEqual({ tests: ['Tour/src/main.test.ts'], packages: ['Tour'], fullSuite: [] });
    expect(impactOf(g, ['Tour/src/global.ts']).fullSuite.map((f) => f.dir)).toEqual(['Tour']);
  });

  it('a deleted markdown file stays ignored', () => {
    expect(full(['Fw/docs/gone.md'])).toEqual([]);
  });
});

// Why these matter: tsc sees edges that no runtime import draws. A dependent's
// tsconfig can include another package's sources (the Recorder includes
// ../GpsPlusSlamJs_AppFramework/src/**/*.ts, the globe names single framework
// files), and a declaration file imports types. A change behind either broke
// a dependent's typecheck while the graph reached no dependent.
describe('impactOf: type-level edges', () => {
  const REC = { dir: 'Rec', name: 'rec', deps: [], exports: undefined };
  /** @param {Record<string, string>} extra */
  const graphWith = (extra) =>
    buildImpactGraph({
      packages: [...PACKAGES, REC],
      files: [...FILES, ...Object.keys(extra)],
      texts: new Map([...Object.entries(TEXTS), ...Object.entries(extra)]),
    });

  it('reaches a package whose tsconfig includes the changed file by a glob (JSONC, as tsc reads it)', () => {
    const g = graphWith({
      'Rec/tsconfig.json': '{\n  // the framework source too\n  "include": ["src/**/*.ts", "../Fw/src/**/*.ts",],\n}',
    });
    expect(impactOf(g, ['Fw/src/a.ts']).packages).toContain('Rec');
    expect(impactOf(g, ['Tour/src/view.ts']).packages).not.toContain('Rec');
  });

  it('reaches a package whose tsconfig names the changed file, and not by another file', () => {
    const g = graphWith({ 'Rec/tsconfig.app.json': '{ "files": ["../Fw/src/utils/u.ts"] }' });
    expect(impactOf(g, ['Fw/src/utils/u.ts']).packages).toContain('Rec');
    expect(impactOf(g, ['Fw/src/a.ts']).packages).not.toContain('Rec');
  });

  // Why: the Recorder's tsconfig.base.json includes ../Fw/src/**/*.ts with no
  // exclude of its own, so a framework test file or a markdown sidecar reached
  // the Recorder although no program it compiles holds either: the configs
  // that extend the base (app, vitest) exclude the framework tests.
  it('an include glob matches its own extension, never a sidecar or a test its programs exclude', () => {
    const g = graphWith({
      'Fw/src/a.ts.md': '',
      'Fw/src/b.js': '',
      'Fw/src/helper.ts': '',
      'Rec/tsconfig.base.json': '{ "include": ["src/**/*.ts", "../Fw/src/**/*.ts"] }',
      'Rec/tsconfig.app.json': '{ "extends": "./tsconfig.base.json", "exclude": ["../Fw/src/**/*.test.ts", "../Fw/src/helper.ts"] }',
      'Rec/tsconfig.vitest.json': '{ "extends": "./tsconfig.base", "exclude": ["../Fw/src/**/*.test.ts"] }',
      'Rec/tsconfig.json': '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.vitest.json" }] }',
    });
    expect(impactOf(g, ['Fw/src/a.ts']).packages).toContain('Rec');
    // Excluded by one program only: the vitest program still compiles it.
    expect(impactOf(g, ['Fw/src/helper.ts']).packages).toContain('Rec');
    for (const path of ['Fw/src/a.test.ts', 'Fw/src/a.ts.md', 'Fw/src/b.js']) {
      expect(impactOf(g, [path]).packages, path).not.toContain('Rec');
    }
  });

  it("honours a tsconfig's own exclude and an inherited one, which an own exclude replaces (as in tsc)", () => {
    const base = '{ "include": ["../Fw/src/**/*.ts"], "exclude": ["../Fw/src/**/*.test.ts"] }';
    // A referenced base is a program of its own.
    const refs = '{ "references": [{ "path": "./tsconfig.base.json" }, { "path": "./tsconfig.app.json" }] }';
    const inherits = graphWith({
      'Rec/tsconfig.base.json': base,
      'Rec/tsconfig.app.json': '{ "extends": "./tsconfig.base.json" }',
      'Rec/tsconfig.json': refs,
    });
    expect(impactOf(inherits, ['Fw/src/a.test.ts']).packages).not.toContain('Rec');
    expect(impactOf(inherits, ['Fw/src/a.ts']).packages).toContain('Rec');
    const replaces = graphWith({
      'Rec/tsconfig.base.json': base,
      'Rec/tsconfig.app.json': '{ "extends": "./tsconfig.base.json", "exclude": ["../Fw/src/utils/**"] }',
      'Rec/tsconfig.json': refs,
    });
    expect(impactOf(replaces, ['Fw/src/a.test.ts']).packages).toContain('Rec');
  });

  // Why: TS 5 allows `extends` as an array, later entries overriding earlier
  // ones. Read only as a string, the extender inherited nothing (a framework
  // change missed the Recorder) and each base counted as a program of its own
  // (its missing exclude reached the Recorder for a framework test).
  it('reads an array extends: inherits from every entry, the last that sets a list wins, no base is a program', () => {
    const g = graphWith({
      'Rec/tsconfig.base.json': '{ "include": ["../Fw/src/**/*.ts"], "exclude": ["../Fw/src/utils/**"] }',
      'Rec/tsconfig.strict.json': '{ "exclude": ["../Fw/src/**/*.test.ts"] }',
      'Rec/tsconfig.app.json': '{ "extends": [\n  "./tsconfig.base.json",\n  "./tsconfig.strict.json"\n] }',
      'Rec/tsconfig.json': '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }',
    });
    expect(impactOf(g, ['Fw/src/a.ts']).packages).toContain('Rec');
    // The later entry's exclude replaces the base's: utils is compiled again.
    expect(impactOf(g, ['Fw/src/utils/u.ts']).packages).toContain('Rec');
    expect(impactOf(g, ['Fw/src/a.test.ts']).packages).not.toContain('Rec');
  });

  it('follows an import inside a declaration file, and resolves an import to one', () => {
    const g = graphWith({
      'Tour/src/shapes.d.ts': "import type { a } from 'fw';\nexport type Shape = typeof a;",
      'Tour/src/shapes.test.ts': "import type { Shape } from './shapes';",
    });
    expect(impactOf(g, ['Fw/src/a.ts']).tests).toContain('Tour/src/shapes.test.ts');
  });
});
