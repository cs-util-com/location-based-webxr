/**
 * Every vitest run whose tests import fast-check runs them under the shared
 * property time limit (`scripts/test-timing/fast-check-time-limit.mjs`).
 *
 * Why this test matters: a failing property whose shrink never ends is
 * synchronous work that vitest's testTimeout cannot interrupt, so it wedges
 * its gate stage silently until someone kills it. The shared setup module
 * turns that into a red test with its seed, but only in the packages whose
 * config lists it, and a package that starts using fast-check later would
 * silently lack it. So the rule is keyed on the signal that matters, "a test
 * file in this package imports fast-check", and checked against the config
 * the package's vitest STAGE actually uses (its `--config` in
 * `scripts/test-timing/projects.mjs`, else vitest's own discovery), not
 * against whichever config file happens to exist.
 *
 * The EFFECT is read inside each package: every package carries
 * `src/fast-check-time-limit.test.ts`, which reads `fc.readConfigureGlobal()`
 * in that package's own run, under its own config and its own fast-check
 * instance. This file is that probe for the root run, and the weakest one:
 * the root run is `isolate: false`, so a test file that imports the setup
 * module directly sets the same global for every file after it in its
 * worker. That is why this file does not import it, and why the root rests
 * on the setupFiles check as much as on the probe. A child process per
 * package from here would read the same thing at a cost repo-config pays on
 * every commit, under load (see tracked-tree.js on process start-up times).
 *
 * What it cannot see: a test file that is not tracked yet (tracked-tree.js),
 * and a test file that imports fast-check under another specifier.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { PROJECTS } from '../../scripts/test-timing/projects.mjs';
import { readTracked, repoRoot, trackedFiles } from './tracked-tree.js';

const SETUP_MODULE = 'fast-check-time-limit.mjs';
const PROBE = 'src/fast-check-time-limit.test.ts';
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
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
 *   fastCheckTests: readonly string[],
 *   config: { config: string | null, stage: boolean },
 *   configText: string | null,
 *   hasProbe: boolean,
 * }[]} packages
 * @returns {string[]} one line per violation
 */
function timeLimitViolations(packages) {
  /** @type {string[]} */
  const violations = [];
  for (const pkg of packages) {
    if (pkg.fastCheckTests.length === 0) continue;
    const why = `${pkg.dir}: ${pkg.fastCheckTests.length} test file(s) import fast-check (e.g. ${pkg.fastCheckTests[0]})`;
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
    if (!pkg.hasProbe) {
      violations.push(`${why}, but it has no ${PROBE} reading the limit in its own run`);
    }
  }
  return violations;
}

/** The real tree, described for `timeLimitViolations`. */
function describeTree() {
  const tests = trackedFiles().filter(
    (path) => TEST_FILE.test(path) && !path.includes('node_modules/')
  );
  const usesFastCheck = tests.filter((path) => IMPORTS_FAST_CHECK.test(readTracked(path)));
  const packageDirs = new Set(PROJECTS.map((p) => p.dir).filter((dir) => dir !== '.'));
  return PROJECTS.map((project) => {
    const owned = usesFastCheck.filter((path) => {
      const top = path.split('/')[0];
      return project.dir === '.' ? !packageDirs.has(top) : top === project.dir;
    });
    const config = vitestConfigOf(project, (rel) => existsSync(join(repoRoot, project.dir, rel)));
    const configPath = config.config === null ? null : join(repoRoot, project.dir, config.config);
    return {
      dir: project.dir,
      fastCheckTests: owned,
      config,
      configText: configPath !== null && existsSync(configPath) ? readTracked(configPath) : null,
      // The root's probe is this file.
      hasProbe: project.dir === '.' || existsSync(join(repoRoot, project.dir, PROBE)),
    };
  });
}

describe('the fast-check time limit', () => {
  it('is set in every vitest run whose tests import fast-check', () => {
    const tree = describeTree();
    // A vacuity guard: the keying must find the packages it exists for.
    expect(tree.filter((pkg) => pkg.fastCheckTests.length > 0).length).toBeGreaterThan(5);
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
  const pkg = (/** @type {Partial<Parameters<typeof timeLimitViolations>[0][0]>} */ over) => ({
    dir: 'Fixture',
    fastCheckTests: ['Fixture/src/a.property.test.ts'],
    config: { config: 'vitest.config.ts', stage: true },
    configText: withSetup,
    hasProbe: true,
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
    expect(timeLimitViolations([pkg({ hasProbe: false })])).toEqual([
      expect.stringContaining(`no ${PROBE}`),
    ]);
  });

  it('fails a package whose tests use fast-check but whose stages run no vitest', () => {
    expect(timeLimitViolations([pkg({ config: { config: null, stage: false } })])).toEqual([
      expect.stringContaining('no gate stage runs vitest'),
    ]);
  });

  it('passes a package that lists it, and ignores one that does not use fast-check', () => {
    expect(timeLimitViolations([pkg({}), pkg({ fastCheckTests: [], configText: '' })])).toEqual(
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
