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
 * the suite): a Playwright stage outside the full set.
 *
 * @param {{ counts?: string | null }} stage
 * @param {Record<string, string | undefined>} env
 * @returns {boolean}
 */
export function tierStageRun(stage, env) {
  return stage.counts === 'playwright' && e2eTier(env) === 'pr';
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

/** @type {{ root: (dir: string) => string, changed: (ref: string, root: string) => string[] }} */
const GIT_IO = {
  root: (dir) =>
    execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' }).trim(),
  changed: (ref, root) => changedPaths(ref, root),
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
  const { root, changed } = { ...GIT_IO, ...io };
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
      try {
        whole = changedSpecNames(changed(ref, top), pkg);
      } catch (error) {
        throw new Error(
          `e2e tier: cannot diff against ${refEnv} "${ref}" to find the changed specs (${String(error)})`,
        );
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
