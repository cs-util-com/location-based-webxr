// Repo-meta test: the CI workflow's job layout (.github/workflows/ci.yml).
//
// Why this test matters: one serial CI job took 3.4-4.1 h, and a red stage
// hid every package after it. So CI no longer runs the root cascade (`pnpm test`) in one serial job; it runs the
// same package gates in parallel jobs, and the Tour Viewer's browser specs in
// lanes chosen by `E2E_LANE`. A split like that fails silently in three ways,
// each of which leaves CI green while checking less:
// - a root cascade stage (a package gate) that no job runs, or that two run;
// - a Tour Viewer lane that no job runs, or a job naming a lane the plan does
//   not have (the runner refuses that one, but only on CI);
// - a job without a time limit, which sits under GitHub's 6 h hard limit and
//   is cancelled with no report at all.
// A `.github/**` change is checked locally only by this file, so CI itself
// is the rest of the test; the first runs after a layout change are watched.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { PROJECTS } from '../../scripts/test-timing/projects.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = parse(readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8'));
const plan = await import(
  pathToFileURL(join(ROOT, 'GpsPlusSlamJs_TourViewer/playwright-tests/e2e-plan.js')).href
);

const TOUR_DIR = 'GpsPlusSlamJs_TourViewer';
const testJob = workflow.jobs.test;
const RESULT_JOB = 'ci-result';
const resultJob = workflow.jobs[RESULT_JOB];
/** @type {{ job: string, dir?: string, scripts: string, lane?: string, skip_browser?: string, browsers?: boolean, report?: string, timeout: number }[]} */
const entries = testJob.strategy.matrix.include;
const rootStages = PROJECTS.find((p) => p.dir === '.').stages.map((s) => s.name);

/** @param {string} dir @returns {Record<string, string>} */
const scriptsOf = (dir) =>
  JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8')).scripts ?? {};

/** @param {{ scripts: string }} entry */
const scriptList = (entry) => entry.scripts.trim().split(/\s+/);

describe('the CI jobs run every root cascade stage exactly once', () => {
  it('runs each root package gate in exactly one job, and nothing at the root besides', () => {
    const atRoot = entries.filter((e) => (e.dir ?? '.') === '.').flatMap(scriptList);
    const expected = rootStages.filter((name) => name !== 'check:deadcode');
    expect([...atRoot].sort()).toEqual([...expected].sort());
  });

  it('runs the dead-code stage in the dedicated deadcode job', () => {
    expect(rootStages).toContain('check:deadcode');
    const runs = workflow.jobs.deadcode.steps.map((s) => s.run ?? '').join('\n');
    expect(runs).toContain('pnpm run check:deadcode');
  });

  it('names only scripts that exist where the job runs them', () => {
    for (const entry of entries) {
      const scripts = scriptsOf(entry.dir ?? '.');
      for (const name of scriptList(entry)) {
        expect(Object.hasOwn(scripts, name), `${entry.job}: ${entry.dir ?? '.'} has no "${name}"`).toBe(true);
      }
    }
  });

  it('gives every job a unique name', () => {
    const names = entries.map((e) => e.job);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('the Tour Viewer runs its static checks and unit tests once, and its browser specs in lanes', () => {
  const laneEntries = entries.filter((e) => e.lane !== undefined);

  it('runs every lane of the plan in exactly one job', () => {
    expect(laneEntries.map((e) => e.lane).sort()).toEqual([...plan.LANES].sort());
  });

  it('runs a lane as the package\'s own e2e stage, with browsers, and uploads its report', () => {
    for (const entry of laneEntries) {
      expect(entry.dir, entry.job).toBe(TOUR_DIR);
      expect(entry.scripts, entry.job).toBe('test:e2e');
      expect(entry.browsers, entry.job).toBe(true);
      expect(entry.report, entry.job).toBe(`${TOUR_DIR}/test-results/`);
    }
  });

  it('runs the Tour Viewer gate without its browser stage, since the lanes run that', () => {
    const tour = entries.filter((e) => scriptList(e).includes('test:tour'));
    expect(tour).toHaveLength(1);
    expect(tour[0].skip_browser).toBe('1');
    expect(scriptList(tour[0])).toEqual(['test:tour']);
  });

  it('skips browser stages in no other job', () => {
    const others = entries.filter((e) => e.skip_browser && !scriptList(e).includes('test:tour'));
    expect(others).toEqual([]);
  });

  it('wires the matrix lane and skip switch into the job environment', () => {
    expect(testJob.env.E2E_LANE).toBe('${{ matrix.lane }}');
    expect(testJob.env.GATE_SKIP_BROWSER_STAGES).toBe('${{ matrix.skip_browser }}');
  });
});

// Why these matter: the jobs run their scripts in one shell step that
// collects the exit codes, so that step alone decides whether a job is red;
// and with eleven jobs a branch rule cannot name each one, so a single
// result job is what a rule or a reader checks.
describe('a red script makes its job red, and one result job says whether all passed', () => {
  const runStep = testJob.steps.find((s) => String(s.name).startsWith('Run ${{ matrix.scripts }}'));

  it('runs every script, remembers a failure, and exits with it', () => {
    expect(runStep, 'the run step').toBeDefined();
    expect(runStep.run).toContain('|| rc=1');
    expect(runStep.run.trim().split('\n').at(-1).trim()).toBe('exit $rc');
  });

  it('never lets the run step pass on a failure or skip it', () => {
    expect(runStep).not.toHaveProperty('continue-on-error');
    expect(runStep).not.toHaveProperty('if');
    expect(testJob).not.toHaveProperty('continue-on-error');
  });

  it('has a result job that waits for every other job, always runs, and is red unless all succeeded', () => {
    expect(resultJob, RESULT_JOB).toBeDefined();
    expect(resultJob.name).toBe('CI result');
    const others = Object.keys(workflow.jobs).filter((id) => id !== RESULT_JOB);
    expect([...resultJob.needs].sort()).toEqual(others.sort());
    expect(resultJob.if).toBe('${{ always() }}');
    expect(resultJob['timeout-minutes']).toBeGreaterThan(0);
    const run = resultJob.steps.map((s) => s.run ?? '').join('\n');
    // Every need must have concluded "success": a cancelled, timed-out or
    // skipped job reads red, not only a failed one.
    expect(run).toContain('all(.value.result == "success")');
    expect(resultJob.steps.map((s) => s.env?.RESULTS)).toContain('${{ toJSON(needs) }}');
  });
});

describe('the workflow stays inside the free plan and never hangs', () => {
  // The result job is not counted: it starts only when the others are done,
  // so it never takes one of the shared concurrent job slots beside them.
  it('has between 8 and 11 jobs per run (20 concurrent jobs are shared by the organisation)', () => {
    const count = entries.length + Object.keys(workflow.jobs).length - 2;
    expect(count).toBeGreaterThanOrEqual(8);
    expect(count).toBeLessThanOrEqual(11);
  });

  it('gives every job a time limit well under the 6 h hard limit', () => {
    expect(workflow.jobs.deadcode['timeout-minutes']).toBeGreaterThan(0);
    expect(testJob['timeout-minutes']).toBe('${{ matrix.timeout }}');
    for (const entry of entries) {
      expect(Number.isInteger(entry.timeout), entry.job).toBe(true);
      expect(entry.timeout, entry.job).toBeGreaterThan(0);
      expect(entry.timeout, entry.job).toBeLessThanOrEqual(90);
    }
  });

  it('lets every job finish when another fails (one red no longer hides the rest)', () => {
    expect(testJob.strategy['fail-fast']).toBe(false);
  });

  // GitHub keeps only ONE pending run per concurrency group, so pushes to
  // main must not share one: of three quick merges the middle one would lose
  // its run. A pull request groups by its ref, so a newer push cancels the old
  // run; every other event gets a group of its own. The group starts with
  // `github.workflow`, which in the full-ci label's call of this workflow is
  // the CALLING workflow's name: the label run gets a group of its own and no
  // longer cancels the pull request's run, which left a cancelled check on
  // the pull request.
  it('cancels a superseded pull request run on the same branch, and gives every push to main its own run', () => {
    expect(workflow.concurrency.group).toBe(
      "${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.ref || github.run_id }}"
    );
    expect(workflow.concurrency['cancel-in-progress']).toBe("${{ github.event_name == 'pull_request' }}");
  });
});

// Why: the per-PR tier runs the `@pr` tests only, so the full set is safe
// only while something still runs it. Each trigger below is one of those
// somethings, and each fails silently when it goes: CI stays green while
// testing less. The tier itself is chosen by E2E_TIER (scripts/e2e/tier.mjs).
describe('the browser tier: the tagged tests per pull request, the full set on schedule and on demand', () => {
  const tierExpr = String(testJob.env.E2E_TIER);
  const raw = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const nightly = parse(readFileSync(join(ROOT, '.github/workflows/nightly-full.yml'), 'utf8'));

  it('runs on every push to a pull request, and the full set on one labelled full-ci', () => {
    expect(workflow.on.pull_request.types).toEqual(['opened', 'synchronize', 'reopened']);
    expect(tierExpr).toContain("contains(github.event.pull_request.labels.*.name, 'full-ci') && 'full'");
  });

  it('runs a dispatch at its tier input, the full set by default', () => {
    const input = workflow.on.workflow_dispatch.inputs.tier;
    expect(input.default).toBe('full');
    expect([...input.options].sort()).toEqual(['full', 'pr']);
    expect(tierExpr).toContain("github.event_name == 'workflow_dispatch' && inputs.tier");
  });

  it('runs the tier on a push to main too: the full-ci label runs the full set before a merge', () => {
    expect(tierExpr).not.toContain("'push'");
    expect(tierExpr.trim().endsWith("|| 'pr' }}")).toBe(true);
  });

  it("gives the tier the pull request's base, and fetches that commit", () => {
    expect(testJob.env.E2E_TIER_BASE).toBe('${{ github.event.pull_request.base.sha }}');
    const fetch = testJob.steps.find((s) => String(s.run ?? '').includes('git fetch'));
    expect(fetch?.run).toContain('"$E2E_TIER_BASE"');
  });

  // A label added to a pull request must start no CI job unless it is
  // full-ci: a skipped job is a check of the same name on the same commit,
  // and a skipped "Dead code" would sit over the red one before it. So this
  // workflow does not listen to labels at all; ci-full-label.yml does, and
  // calls it for full-ci only, in a concurrency group of its own.
  it('starts no job on any other label, and runs the whole workflow on full-ci', () => {
    const label = parse(readFileSync(join(ROOT, '.github/workflows/ci-full-label.yml'), 'utf8'));
    expect(label.on.pull_request.types).toEqual(['labeled']);
    expect(Object.keys(label.jobs)).toHaveLength(1);
    const call = Object.values(label.jobs)[0];
    expect(call.if).toBe("${{ github.event.label.name == 'full-ci' }}");
    expect(call.uses).toBe('./.github/workflows/ci.yml');
    expect(workflow.on).toHaveProperty('workflow_call');
    expect(raw).not.toContain('labeled');
    expect(resultJob.if).toBe('${{ always() }}');
  });

  it('dispatches the full set nightly on the newest rNNN branch whose ci.yml can be dispatched', () => {
    expect(nightly.on.schedule).toHaveLength(1);
    expect(nightly.permissions.actions).toBe('write');
    const run = nightly.jobs.dispatch.steps.map((s) => s.run ?? '').join('\n');
    expect(run).toContain('gh workflow run ci.yml --ref "$branch" -f tier=full');
    expect(nightly.jobs.dispatch['timeout-minutes']).toBeGreaterThan(0);
    // A branch older than the workflow_dispatch trigger refuses the dispatch
    // (HTTP 422) and the night would run nothing: each candidate's ci.yml is
    // read first, newest first, then main; finding none is an error.
    expect(run).toContain('contents/.github/workflows/ci.yml?ref=');
    expect(run).toContain('workflow_dispatch');
    expect(run).toMatch(/for branch in [^\n]* main/);
    expect(run).toContain('::error::');
  });

  it("keeps the design system's measurement specs out of every run", () => {
    // DS_E2E_TIER=full adds hours of SwiftShader sweeps; they run by hand.
    expect(raw).not.toContain('DS_E2E_TIER');
  });
});
