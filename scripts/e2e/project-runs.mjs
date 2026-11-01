// Pure parts of run-projects.mjs: the Playwright arguments of one project's
// run, the DOM project's worker count, whether a run may be narrowed to an
// area, and the merge of the per-project JSON reports into the one report the
// gate's counts and CI's artifact read. No I/O here, so every rule is
// unit-testable.

import { onGithubRunner } from '../test-timing/stage-args.mjs';

/** Env var that overrides the DOM project's local worker count (measurements). */
export const DOM_WORKERS_ENV = 'E2E_DOM_WORKERS';

/** Env var naming the git ref a `test:changed` run diffs against (select.mjs). */
export const CHANGED_REF_ENV = 'GATE_CHANGED_REF';

/**
 * The DOM project's worker count.
 *
 * One on the GitHub runner: its own worker count was never measured, so CI
 * keeps the one worker it had. Locally the plan's default, unless
 * `E2E_DOM_WORKERS` names a whole number from 1 to 16.
 *
 * @param {Record<string, string | undefined>} env
 * @param {number} localDefault
 * @returns {number}
 * @throws {RangeError} on an `E2E_DOM_WORKERS` that is not a whole number 1..16
 */
export function domWorkers(env, localDefault) {
  if (onGithubRunner(env)) return 1;
  const raw = env[DOM_WORKERS_ENV];
  if (raw === undefined || raw === '') return localDefault;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 16) {
    throw new RangeError(
      `${DOM_WORKERS_ENV} must be a whole number from 1 to 16, got "${raw}"`
    );
  }
  return n;
}

/**
 * Whether a run may be narrowed to the changed area: never on the GitHub
 * runner (CI runs everything), only inside a `test:changed` run (it names the
 * ref), and only when nothing but the gate's own reporter flags was forwarded
 * (a developer's filter is the selection then).
 *
 * @param {Record<string, string | undefined>} env
 * @param {readonly string[]} forwarded - args after the canonical command
 * @returns {boolean}
 */
export function mayNarrow(env, forwarded) {
  if (onGithubRunner(env)) return false;
  if (!env[CHANGED_REF_ENV]) return false;
  return forwarded.every((arg) => arg.startsWith('--reporter='));
}

/**
 * A Playwright file filter matching exactly one spec file name (the CLI
 * treats a filter as a regular expression over the file's path).
 *
 * @param {string} name - a file name such as `editor3d.spec.js`
 * @returns {string}
 */
export function specFilter(name) {
  return `[\\\\/]${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
}

/**
 * The CLI arguments of one project's run.
 *
 * `--pass-with-no-tests`: a developer's filter that matches only the other
 * project's specs leaves this one empty, which is not a failure.
 *
 * @param {{ base: readonly string[], project: string, workers: number, specs?: readonly string[] | null }} run
 * @returns {string[]}
 */
export function projectArgs({ base, project, workers, specs = null }) {
  return [
    ...base,
    '--project',
    project,
    '--workers',
    String(workers),
    '--pass-with-no-tests',
    ...(specs ?? []).map(specFilter),
  ];
}

/** @param {unknown} v @returns {number} */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Merges the JSON reports of runs that ran one after the other into one:
 * the suites and errors of all, the counts summed, the duration summed (the
 * runs did not overlap), the first run's config and start time.
 *
 * @param {readonly any[]} reports - parsed Playwright JSON reports
 * @returns {any}
 * @throws {TypeError} on an empty list or a report without a stats object
 */
export function mergeReports(reports) {
  if (reports.length === 0) throw new TypeError('no report to merge');
  for (const r of reports) {
    if (!r || typeof r !== 'object' || !r.stats || typeof r.stats !== 'object') {
      throw new TypeError('a Playwright report without a stats object');
    }
  }
  const [first] = reports;
  const stats = { ...first.stats };
  for (const key of ['expected', 'unexpected', 'flaky', 'skipped', 'duration']) {
    stats[key] = reports.reduce((sum, r) => sum + num(r.stats[key]), 0);
  }
  return {
    ...first,
    suites: reports.flatMap((r) => (Array.isArray(r.suites) ? r.suites : [])),
    errors: reports.flatMap((r) => (Array.isArray(r.errors) ? r.errors : [])),
    stats,
  };
}

/**
 * The per-project name of a report file: `results.json` -> `results.dom.json`.
 *
 * @param {string} file
 * @param {string} project
 * @returns {string}
 */
export function projectReportName(file, project) {
  return file.endsWith('.json')
    ? `${file.slice(0, -'.json'.length)}.${project}.json`
    : `${file}.${project}.json`;
}
