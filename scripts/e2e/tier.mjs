// The browser tier a Playwright run selects: `pr` (the default) runs the
// tests whose title ends in the `@pr` tag, plus every test of a spec file the
// branch adds or changes; `full` runs every test. Chosen by the `E2E_TIER`
// environment variable, never by forwarded arguments (a forwarded argument is
// a developer's filter, which may select nothing: `project-runs.mjs`,
// `developerFiltered`). Read by every package's Playwright config (`grep`,
// `retries`), by `run-projects.mjs` (whether an empty run passes) and by
// `scripts/test-timing/run-stage.mjs` (a tier run records no timing row).
// The tagged set itself is pinned by tests/repo-config/e2e-pr-tier.test.js.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { changedPaths } from '../test-changed/changed-paths.mjs';
import { CHANGED_REF_ENV } from './project-runs.mjs';

/** Env var choosing the tier: `pr` (default) or `full`. */
export const TIER_ENV = 'E2E_TIER';

/** Env var naming the git ref a tier run diffs against when no gate ref is set (CI: the pull request's base). */
export const TIER_BASE_ENV = 'E2E_TIER_BASE';

/**
 * Env var by which `run-projects.mjs` tells the config whether ITS command
 * line holds a developer's selection (`1`) or only its own spec list (`0`).
 */
export const DEVELOPER_FILTER_ENV = 'E2E_DEVELOPER_FILTER';

/** Where the Playwright main process leaves its answer for its workers. */
const RESOLVED_ENV = 'E2E_TIER_RESOLVED';

/** The tier names. */
export const TIERS = /** @type {const} */ (['pr', 'full']);

/**
 * Minutes one Playwright process may run. Set per job by ci.yml, unset
 * elsewhere: a laptop under load has no comparable number.
 */
export const GLOBAL_TIMEOUT_ENV = 'E2E_GLOBAL_TIMEOUT_MIN';

/**
 * The tier a run selects.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {"pr" | "full"}
 * @throws {RangeError} on a value other than empty, `pr` or `full`
 */
export function e2eTier(env) {
  const raw = env[TIER_ENV];
  if (raw === undefined || raw === '') return 'pr';
  if (raw === 'pr' || raw === 'full') return raw;
  throw new RangeError(`${TIER_ENV} must be "pr" or "full", got "${raw}"`);
}

/**
 * The Playwright `globalTimeout` in milliseconds, 0 (no limit) when none is
 * set. It ends a hung run as a normal red before the job's own limit cancels
 * the job, because a cancelled job keeps no log and uploads no report.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {number}
 * @throws {RangeError} on anything but a positive number of minutes, so a typo
 * never switches the limit off
 */
export function tierGlobalTimeout(env) {
  const raw = env[GLOBAL_TIMEOUT_ENV];
  if (raw === undefined || raw === '') return 0;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new RangeError(`${GLOBAL_TIMEOUT_ENV} must be a positive number, got "${raw}"`);
  }
  return Math.round(minutes * 60_000);
}

/**
 * The Playwright retry count: on CI one in the tier and two in the full set
 * (a full run is rarer and longer, so one more flake is likelier there);
 * locally the package's own count.
 *
 * @param {Record<string, string | undefined>} env
 * @param {number} [localRetries]
 * @returns {number}
 */
export function tierRetries(env, localRetries = 0) {
  if (!env.CI) return localRetries;
  return e2eTier(env) === 'full' ? 2 : 1;
}

/** @param {string} s */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Playwright's `grep` for a run, matched against "project file describe
 * title tags": the tag, plus one pattern per changed spec file name (that
 * file whole). `undefined` (every test) in the full set.
 *
 * @param {Record<string, string | undefined>} env
 * @param {readonly string[]} wholeSpecs - spec file names that run whole
 * @returns {RegExp[] | undefined}
 */
export function tierGrep(env, wholeSpecs) {
  if (e2eTier(env) === 'full') return undefined;
  return [
    /(^|\s)@pr(\s|$)/,
    ...wholeSpecs.map((name) => new RegExp(`(^|[\\s/\\\\])${escapeRegExp(name)}(\\s|$)`)),
  ];
}

/**
 * The spec file names among changed repo paths that belong to one package.
 *
 * @param {readonly string[]} paths - repo-relative, either slash style
 * @param {string} pkg - the package folder, e.g. `GpsPlusSlamJs_TourViewer`
 * @returns {string[]}
 */
export function changedSpecNames(paths, pkg) {
  return paths
    .map((p) => p.replaceAll('\\', '/'))
    .filter((p) => p.startsWith(`${pkg}/`) && /\.spec\.m?js$/.test(p))
    .map((p) => p.slice(p.lastIndexOf('/') + 1));
}

/** A relative import or re-export specifier in a test script. */
const RELATIVE_IMPORT = /(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g;

/** @param {string} p */
const posix = (p) => p.replaceAll('\\', '/');

/**
 * The spec file names whose relative imports reach a changed file, directly
 * or through other helpers: a changed fixture or helper runs every spec that
 * uses it whole. A changed spec itself is `changedSpecNames`' part.
 *
 * @param {readonly string[]} paths - changed repo-relative paths, either slash style
 * @param {Readonly<Record<string, string>>} sources - repo-relative posix path -> source, the specs and helpers to follow
 * @returns {string[]} sorted, without duplicates
 */
export function specsImporting(paths, sources) {
  const changed = new Set(paths.map(posix));
  /** @type {Map<string, string[]>} file -> the files it imports */
  const imports = new Map();
  for (const [file, source] of Object.entries(sources)) {
    const dir = path.posix.dirname(file);
    imports.set(
      file,
      [...source.matchAll(RELATIVE_IMPORT)].map((m) => path.posix.join(dir, m[1])),
    );
  }
  // Walked backwards from the changed files: every file importing a reached
  // one is reached. No answer is cached mid-walk, so an import cycle cannot
  // leave a wrong "no" behind for a file met while its importer was open.
  /** @type {Map<string, string[]>} file -> the files importing it */
  const importers = new Map();
  for (const [file, deps] of imports) {
    for (const dep of deps) importers.set(dep, [...(importers.get(dep) ?? []), file]);
  }
  /** @type {Set<string>} */
  const reached = new Set();
  const todo = [...changed];
  while (todo.length > 0) {
    const file = /** @type {string} */ (todo.pop());
    for (const importer of importers.get(file) ?? []) {
      if (reached.has(importer)) continue;
      reached.add(importer);
      todo.push(importer);
    }
  }
  return Object.keys(sources)
    .filter((file) => /\.spec\.m?js$/.test(file) && reached.has(file))
    .map((file) => file.slice(file.lastIndexOf('/') + 1))
    .filter((name, i, all) => all.indexOf(name) === i)
    .sort();
}

/** Folders never searched for test scripts. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'test-results', 'playwright-report', 'src', 'public']);

/**
 * The test scripts (`.js`, `.mjs`) under a config's folder, outside the app's
 * own sources and the build output, keyed repo-relative.
 *
 * @param {string} dir - absolute
 * @param {string} top - the repo root, absolute
 * @returns {Record<string, string>}
 */
function readTestSources(dir, top) {
  /** @type {Record<string, string>} */
  const out = {};
  /** @param {string} d */
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.m?js$/.test(entry.name)) out[posix(path.relative(top, full))] = readFileSync(full, 'utf8');
    }
  };
  walk(dir);
  return out;
}

/**
 * The total of a `playwright test --list` run's output: its "Total: N
 * tests" line, 0 for "No tests found", `null` when neither is there.
 *
 * @param {string} output - stdout and stderr together
 * @returns {number | null}
 */
export function listedTotal(output) {
  const total = /Total: (\d+) tests? in/.exec(output);
  if (total) return Number(total[1]);
  return /No tests found/.test(output) ? 0 : null;
}

/**
 * The warning for a project's run cut to the changed area that selects no
 * test in the tier: it passes (the tier allows it), so it must not read as
 * a green browser run. `null` when tests run or the count is unknown.
 *
 * @param {{ project: string, areas: readonly string[], ref: string, total: number | null }} run
 * @returns {string | null}
 */
export function emptyTierWarning({ project, areas, ref, total }) {
  if (total !== 0) return null;
  const area = areas.length > 0 ? areas.join(', ') : 'none';
  return (
    `WARNING e2e project ${project}: 0 tests run. The changed area (${area}, vs ${ref}) holds no @pr test ` +
    'and no changed spec, so the per-PR tier ran nothing here; E2E_TIER=full runs every test of the area.'
  );
}

/**
 * The warning for a tier project whose `--list` probe failed or printed no
 * count: whether it selects any test is unknown, so the run that follows
 * may pass with none, and that must not read as a green browser run.
 * `null` when the probe gave a count.
 *
 * @param {{ project: string, status: number | null, total: number | null }} probe
 * @returns {string | null}
 */
export function failedProbeWarning({ project, status, total }) {
  if (status === 0 && total !== null) return null;
  const why = status === 0 ? 'printed no test count' : `exited ${status ?? 'by a signal'}`;
  return (
    `WARNING e2e project ${project}: the --list probe ${why}, so whether the per-PR tier selects any test here is unknown; ` +
    'the run below may pass with 0 tests. Its own summary line says how many ran.'
  );
}

/** Playwright `test` options that take their value as the next argument. */
const VALUE_OPTIONS = new Set([
  '-c',
  '--config',
  '--project',
  '-j',
  '--workers',
  '--reporter',
  '--output',
  '--repeat-each',
  '--retries',
  '--timeout',
  '--max-failures',
  '--shard',
  '--trace',
  '--tsconfig',
  '--global-timeout',
  '--update-source-method',
  '--browser',
]);

/** Options that select tests themselves. */
const SELECTING =
  /^(-g|--grep|--grep-invert|--last-failed|--only-changed|--test-list|--test-list-invert)(=|$)/;

/**
 * Whether a run's command line holds a developer's own selection (a file
 * filter, a grep, `--last-failed`), which then is the selection: the tier
 * never narrows the files a developer named. `run-projects.mjs` says so
 * itself (`E2E_DEVELOPER_FILTER`), since its command line carries its own
 * spec filters. An unknown option followed by a value reads the value as a
 * filter, which only turns the tier off: more tests, never fewer.
 *
 * @param {readonly string[]} argv - the process's argv
 * @param {Record<string, string | undefined>} env
 * @returns {boolean}
 */
export function developerSelected(argv, env) {
  const said = env[DEVELOPER_FILTER_ENV];
  if (said === '1') return true;
  if (said === '0') return false;
  const at = argv.indexOf('test', 2);
  if (at === -1) return false;
  const args = argv.slice(at + 1);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (SELECTING.test(arg)) return true;
    if (VALUE_OPTIONS.has(arg)) {
      i += 1;
      continue;
    }
    if (!arg.startsWith('-')) return true;
  }
  return false;
}

/**
 * Whether a stage run is a tier run, which records no timing row (it is not
 * the suite): a Playwright stage outside the full set, or a root stage that
 * runs a package's whole gate (`nestedGate`) while that gate's browser
 * stages run the tier. Without the second, the root cascade recorded its
 * package rows and its total for a partial browser run, and those entered
 * the medians of the full runs. In dependent mode (`skipBrowser`) a nested
 * gate runs no browser stage, so the tier does not touch it.
 *
 * @param {{ counts?: string | null, nestedGate?: boolean }} stage
 * @param {Record<string, string | undefined>} env
 * @param {{ skipBrowser?: boolean }} [mode]
 * @returns {boolean}
 */
export function tierStageRun(stage, env, { skipBrowser = false } = {}) {
  if (e2eTier(env) !== 'pr') return false;
  if (stage.counts === 'playwright') return true;
  return stage.nestedGate === true && !skipBrowser;
}

/**
 * Whether a project's run may select no test and pass: a developer's filter,
 * or a tier run narrowed to the changed area (whose specs may hold no tagged
 * test). Never a whole tier run or a CI lane: those fail when empty.
 *
 * @param {{ developerFiltered: boolean, narrowed: boolean, env: Record<string, string | undefined> }} run
 * @returns {boolean}
 */
export function passesEmpty({ developerFiltered, narrowed, env }) {
  return developerFiltered || (narrowed && e2eTier(env) === 'pr');
}

/** @type {{ root: (dir: string) => string, changed: (ref: string, root: string) => string[], sources: (dir: string, root: string) => Record<string, string> }} */
const GIT_IO = {
  root: (dir) =>
    execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' }).trim(),
  changed: (ref, root) => changedPaths(ref, root),
  sources: readTestSources,
};

/**
 * A package config's `grep`: `tierGrep` with the package's changed spec
 * files, diffed against the gate's ref (`GATE_CHANGED_REF`) or else
 * `E2E_TIER_BASE`; no base, no changed specs. `undefined` in the full set
 * or for a developer's own selection. The answer is left in the environment
 * for the run's workers, which load the config again.
 *
 * @param {string} configUrl - the config's `import.meta.url`
 * @param {{ env?: Record<string, string | undefined>, argv?: readonly string[], io?: Partial<typeof GIT_IO> }} [options]
 * @returns {RegExp[] | undefined}
 * @throws {Error} when the base cannot be diffed (an unknown ref): the run
 *   stops rather than skip the changed specs
 */
export function playwrightGrep(
  configUrl,
  { env = process.env, argv = process.argv, io = {} } = {},
) {
  const configDir = path.dirname(fileURLToPath(configUrl));
  const cached = env[RESOLVED_ENV];
  if (cached) {
    const parsed = JSON.parse(cached);
    if (parsed.configDir === configDir) {
      return parsed.grep === null
        ? undefined
        : parsed.grep.map((/** @type {string} */ s) => new RegExp(s));
    }
  }
  const { root, changed, sources } = { ...GIT_IO, ...io };
  /** @type {RegExp[] | undefined} */
  let grep;
  if (e2eTier(env) === 'full' || developerSelected(argv, env)) {
    grep = undefined;
  } else {
    const refEnv = env[CHANGED_REF_ENV]
      ? CHANGED_REF_ENV
      : env[TIER_BASE_ENV]
        ? TIER_BASE_ENV
        : null;
    /** @type {string[]} */
    let whole = [];
    if (refEnv) {
      const ref = /** @type {string} */ (env[refEnv]);
      const top = root(configDir);
      const pkg = path.relative(top, configDir).split(/[\\/]/)[0];
      /** @type {string[]} */
      let paths;
      try {
        paths = changed(ref, top);
      } catch (error) {
        throw new Error(
          `e2e tier: cannot diff against ${refEnv} "${ref}" to find the changed specs (${String(error)})`,
        );
      }
      whole = changedSpecNames(paths, pkg);
      // A changed test script that is not a spec (a fixture, a helper): the
      // specs importing it run whole. Read only when there is one.
      const helpers = paths
        .map(posix)
        .filter(
          (p) =>
            p.startsWith(`${pkg}/`) &&
            /\.m?js$/.test(p) &&
            !/\.spec\.m?js$/.test(p) &&
            !p.startsWith(`${pkg}/src/`),
        );
      if (helpers.length > 0) {
        whole = [...new Set([...whole, ...specsImporting(helpers, sources(configDir, top))])];
      }
    }
    grep = tierGrep(env, whole);
  }
  env[RESOLVED_ENV] = JSON.stringify({
    configDir,
    grep: grep ? grep.map((re) => re.source) : null,
  });
  return grep;
}
