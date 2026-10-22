/**
 * Every vitest run whose tests import fast-check runs them under the shared
 * property time limit (`scripts/test-timing/fast-check-time-limit.mjs`).
 *
 * Why this test matters: a failing property whose shrink never ends is
 * synchronous work that vitest's testTimeout cannot interrupt, so it wedges
 * its gate stage silently until someone kills it. The shared setup module
 * turns that into a red test with its seed, but only in the packages whose
 * config lists it, and a package that starts using fast-check later would
 * silently lack it. So the rule is keyed on the signal that matters, "a
 * source file in this package imports fast-check" (a test, or a helper that
 * builds arbitraries for tests), and checked against the config the
 * package's vitest STAGE actually uses (its `--config` in
 * `scripts/test-timing/projects.mjs`, else vitest's own discovery), not
 * against whichever config file happens to exist.
 *
 * The EFFECT is read inside each package: every package carries
 * `src/fast-check-time-limit.test.ts`, which reads `fc.readConfigureGlobal()`
 * in that package's own run, under its own config and its own fast-check
 * instance. The rule checks that the probe reads it and that the stage's
 * `include` globs collect it, since a probe the run never collects reads
 * nothing. This file is that probe for the root run, and the weakest one:
 * the root run is `isolate: false`, so a test file that imports the setup
 * module directly sets the same global for every file after it in its
 * worker. That is why this file does not import it, and why the root rests
 * on the setupFiles check as much as on the probe. A child process per
 * package from here would read the same thing at a cost repo-config pays on
 * every commit, under load (see tracked-tree.js on process start-up times).
 *
 * What it cannot see: a file that is not tracked yet (tracked-tree.js), a
 * file that imports fast-check under another specifier, an `include` built
 * from a variable rather than written as a list of strings (it is then
 * reported as not collecting the probe, which fails loud), and an `exclude`
 * that drops the probe again.
 */
import { existsSync } from 'node:fs';
import { join, posix } from 'node:path';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { PROJECTS } from '../../scripts/test-timing/projects.mjs';
import { readTracked, repoRoot, trackedFiles } from './tracked-tree.js';

const SETUP_MODULE = 'fast-check-time-limit.mjs';
const PROBE = 'src/fast-check-time-limit.test.ts';
/** The root run's probe: this file. */
const ROOT_PROBE = 'tests/repo-config/fast-check-time-limit.test.js';
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const IMPORTS_FAST_CHECK = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]fast-check['"]/;
/** vitest's own discovery order when a stage passes no `--config`. */
const DEFAULT_CONFIGS = ['vitest', 'vite'].flatMap((base) =>
  ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].map((ext) => `${base}.config.${ext}`)
);

/**
 * Drops whole-line comments only. Configs hold globs such as
 * `src/**\/*.test.ts` inside strings, which a general comment regex reads
 * as the start or end of a block comment.
 *
 * @param {string} source
 */
function stripComments(source) {
  return source.replace(/^\s*\/\*[\s\S]*?\*\/[ \t]*$/gm, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * The tracked source files that import fast-check: tests and the helpers
 * that build arbitraries for them alike.
 *
 * @param {readonly string[]} paths - tracked repo-relative paths
 * @param {(path: string) => string} read
 * @returns {string[]}
 */
function fastCheckFilesOf(paths, read) {
  return paths.filter(
    (path) =>
      SOURCE_FILE.test(path) && !path.includes('node_modules/') && IMPORTS_FAST_CHECK.test(read(path))
  );
}

/**
 * The test `include` globs of a vitest config: the strings of its FIRST
 * `include: [...]` list, which in every config here is `test.include`
 * (`coverage.include` comes later). Null when the config has none (vitest's
 * default then collects every `*.test.*` file, the probe included).
 *
 * @param {string} configText
 * @returns {string[] | null}
 */
function includeGlobs(configText) {
  const list = stripComments(configText).match(/\binclude\s*:\s*\[([^\]]*)\]/);
  if (!list) return null;
  return [...list[1].matchAll(/(['"`])([^'"`]+)\1/g)].map((m) => m[2]);
}

/**
 * The config file a project's vitest stage runs with, relative to the
 * project dir, or null when no stage runs vitest.
 *
 * @param {{ stages: readonly { command: string }[] }} project
 * @param {(relativePath: string) => boolean} exists
 * @returns {{ config: string | null, stage: boolean }}
 */
function vitestConfigOf(project, exists) {
  const stage = project.stages.find((s) => /(?:^|\s|&&\s*)vitest\s/.test(`${s.command} `));
  if (!stage) return { config: null, stage: false };
  const explicit = stage.command.match(/--config(?:=|\s+)("?)([^\s"]+)\1/);
  if (explicit) return { config: explicit[2], stage: true };
  return { config: DEFAULT_CONFIGS.find(exists) ?? null, stage: true };
}

/**
 * The rule, over a description of the tree, so its failure can be shown on a
 * fixture without touching a real package.
 *
 * @param {{
 *   dir: string,
 *   fastCheckFiles: readonly string[],
 *   config: { config: string | null, stage: boolean },
 *   configText: string | null,
 *   probe: { path: string, text: string | null },
 * }[]} packages
 * @returns {string[]} one line per violation
 */
function timeLimitViolations(packages) {
  /** @type {string[]} */
  const violations = [];
  for (const pkg of packages) {
    if (pkg.fastCheckFiles.length === 0) continue;
    const why = `${pkg.dir}: ${pkg.fastCheckFiles.length} file(s) import fast-check (e.g. ${pkg.fastCheckFiles[0]})`;
    if (!pkg.config.stage) {
      violations.push(`${why}, but no gate stage runs vitest there`);
      continue;
    }
    if (pkg.config.config === null || pkg.configText === null) {
      violations.push(`${why}, but the config its vitest stage uses was not found`);
      continue;
    }
    const listed = /setupFiles\s*:\s*\[[^\]]*fast-check-time-limit\.mjs/.test(
      stripComments(pkg.configText)
    );
    if (!listed) {
      violations.push(
        `${why}, but ${pkg.dir}/${pkg.config.config} does not list scripts/test-timing/${SETUP_MODULE} in setupFiles`
      );
    }
    if (pkg.probe.text === null) {
      violations.push(`${why}, but it has no ${pkg.probe.path} reading the limit in its own run`);
      continue;
    }
    if (!pkg.probe.text.includes('readConfigureGlobal')) {
      violations.push(`${why}, but its probe ${pkg.probe.path} does not read fc.readConfigureGlobal()`);
    }
    const globs = includeGlobs(pkg.configText);
    if (globs !== null && !globs.some((glob) => posix.matchesGlob(pkg.probe.path, glob))) {
      violations.push(
        `${why}, but its probe ${pkg.probe.path} is outside the include of ${pkg.dir}/${pkg.config.config} (${globs.join(', ') || 'no string globs'}), so its run never collects it`
      );
    }
  }
  return violations;
}

/** The real tree, described for `timeLimitViolations`. */
function describeTree() {
  const usesFastCheck = fastCheckFilesOf(trackedFiles(), readTracked);
  const packageDirs = new Set(PROJECTS.map((p) => p.dir).filter((dir) => dir !== '.'));
  return PROJECTS.map((project) => {
    const owned = usesFastCheck.filter((path) => {
      const top = path.split('/')[0];
      return project.dir === '.' ? !packageDirs.has(top) : top === project.dir;
    });
    const config = vitestConfigOf(project, (rel) => existsSync(join(repoRoot, project.dir, rel)));
    const configPath = config.config === null ? null : join(repoRoot, project.dir, config.config);
    const probePath = project.dir === '.' ? ROOT_PROBE : PROBE;
    const probeFile = join(repoRoot, project.dir, probePath);
    return {
      dir: project.dir,
      fastCheckFiles: owned,
      config,
      configText: configPath !== null && existsSync(configPath) ? readTracked(configPath) : null,
      probe: { path: probePath, text: existsSync(probeFile) ? readTracked(probeFile) : null },
    };
  });
}

describe('the fast-check time limit', () => {
  it('is set in every vitest run whose tests import fast-check', () => {
    const tree = describeTree();
    // A vacuity guard: the keying must find the packages it exists for.
    expect(tree.filter((pkg) => pkg.fastCheckFiles.length > 0).length).toBeGreaterThan(5);
    expect(timeLimitViolations(tree)).toEqual([]);
  });

  it('is live in the root run (this file is the root probe)', () => {
    const settings = fc.readConfigureGlobal();
    // The value itself is pinned once, in fast-check-time-limit.test.mjs.
    expect(settings.interruptAfterTimeLimit).toBeGreaterThan(0);
    expect(settings.markInterruptAsFailure).toBe(true);
  });
});

describe('the rule itself', () => {
  const withSetup = `export default defineConfig({ test: {
    setupFiles: ['../scripts/test-timing/fast-check-time-limit.mjs'] } });`;
  const probe = {
    path: PROBE,
    text: "expect(fc.readConfigureGlobal().markInterruptAsFailure).toBe(true);",
  };
  const pkg = (/** @type {Partial<Parameters<typeof timeLimitViolations>[0][0]>} */ over) => ({
    dir: 'Fixture',
    fastCheckFiles: ['Fixture/src/a.property.test.ts'],
    config: { config: 'vitest.config.ts', stage: true },
    configText: withSetup,
    probe,
    ...over,
  });

  it('fails a package that uses fast-check without the setup module', () => {
    const violations = timeLimitViolations([
      pkg({ configText: `export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });` }),
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('Fixture/vitest.config.ts does not list');
  });

  it('reads a setupFiles entry after a glob that looks like a block comment', () => {
    expect(
      timeLimitViolations([
        pkg({
          configText: `// Specs in \`playwright-tests/*.spec.js\` stay out; include \`src/**/*.test.ts\`.
export default defineConfig({ test: {
    setupFiles: ['../scripts/test-timing/fast-check-time-limit.mjs'],
    include: ['src/**/*.test.ts'] } });`,
        }),
      ])
    ).toEqual([]);
  });

  it('does not count a mention in a comment as listing it', () => {
    const violations = timeLimitViolations([
      pkg({
        configText: `// setupFiles: ['../scripts/test-timing/fast-check-time-limit.mjs']
export default defineConfig({ test: { setupFiles: ['src/test-setup.ts'] } });`,
      }),
    ]);
    expect(violations).toHaveLength(1);
  });

  it('fails a package without the probe that reads the effect', () => {
    expect(timeLimitViolations([pkg({ probe: { path: PROBE, text: null } })])).toEqual([
      expect.stringContaining(`no ${PROBE}`),
    ]);
  });

  it('fails a probe that does not read the global settings', () => {
    expect(
      timeLimitViolations([pkg({ probe: { path: PROBE, text: "it('runs', () => {});" } })])
    ).toEqual([expect.stringContaining('does not read fc.readConfigureGlobal()')]);
  });

  // Why: a probe outside the stage's `include` is never collected, so it
  // would read nothing while the rule counted it as present.
  it("fails a probe the stage's include never collects", () => {
    const configText = `export default defineConfig({ test: {
    setupFiles: ['../scripts/test-timing/fast-check-time-limit.mjs'],
    include: ['tests/**/*.test.ts'] },
    coverage: { include: ['src/**/*.ts'] } });`;
    expect(timeLimitViolations([pkg({ configText })])).toEqual([
      expect.stringContaining('is outside the include of Fixture/vitest.config.ts (tests/**/*.test.ts)'),
    ]);
    // A config without an include uses vitest's default, which collects it.
    expect(timeLimitViolations([pkg({ configText: withSetup })])).toEqual([]);
  });

  it('reads the test include, not the coverage include, past comment lines', () => {
    expect(
      includeGlobs(`test: { include: [
      'src/**/*.test.ts',
      // node-only script tests
      "scripts/**/*.test.mjs",
    ], coverage: { include: ['src/**/*.ts'] } }`)
    ).toEqual(['src/**/*.test.ts', 'scripts/**/*.test.mjs']);
    expect(includeGlobs('test: { environment: "node" }')).toBeNull();
  });

  // Why: a helper that builds arbitraries imports fast-check without being a
  // test file, and the package running it needs the limit just the same.
  it('keys on any source file that imports fast-check, not only on test files', () => {
    const files = {
      'P/src/arbitraries.ts': "import fc from 'fast-check';",
      'P/src/a.test.ts': "import { arb } from './arbitraries';",
      'P/src/plain.ts': 'export const x = 1;',
      'P/README.md': "import fc from 'fast-check'",
      'P/node_modules/x/index.js': "require('fast-check')",
    };
    expect(
      fastCheckFilesOf(Object.keys(files), (p) => files[/** @type {keyof typeof files} */ (p)])
    ).toEqual(['P/src/arbitraries.ts']);
  });

  it('fails a package whose tests use fast-check but whose stages run no vitest', () => {
    expect(timeLimitViolations([pkg({ config: { config: null, stage: false } })])).toEqual([
      expect.stringContaining('no gate stage runs vitest'),
    ]);
  });

  it('passes a package that lists it, and ignores one that does not use fast-check', () => {
    expect(timeLimitViolations([pkg({}), pkg({ fastCheckFiles: [], configText: '' })])).toEqual(
      []
    );
  });

  it('reads the config from the stage command, else from vitest discovery', () => {
    const stages = (/** @type {string} */ command) => ({ stages: [{ command }] });
    expect(vitestConfigOf(stages('vitest run --coverage --config=config/vitest.config.ts'), () => false)).toEqual({ config: 'config/vitest.config.ts', stage: true });
    expect(vitestConfigOf(stages('vitest run --config vitest.config.js'), () => false)).toEqual({ config: 'vitest.config.js', stage: true });
    expect(vitestConfigOf(stages('vitest run'), (rel) => rel === 'vitest.config.ts')).toEqual({ config: 'vitest.config.ts', stage: true });
    expect(vitestConfigOf(stages('node --test x.mjs'), () => true)).toEqual({ config: null, stage: false });
  });
});
