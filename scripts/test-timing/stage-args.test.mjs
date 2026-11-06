// Why this test matters: recording must only happen for canonical full-suite
// runs. If filtered runs (pnpm run test:unit -- src/foo.test.ts) ever record,
// the history compares a 1-file run against a full run and every delta lies.
// Canonical commands live in stages.mjs, so ANY forwarded arg ⇒ filtered run.
import { describe, it, expect } from 'vitest';
import {
  decideRecording,
  appendArgs,
  buildStageCommand,
} from './stage-args.mjs';

describe('decideRecording', () => {
  it('records a run with no forwarded args outside CI', () => {
    expect(decideRecording([], {})).toEqual({
      record: true,
      extraArgs: [],
      reason: 'full-suite',
    });
  });

  it('strips a leading "--" separator forwarded by pnpm', () => {
    expect(decideRecording(['--'], {})).toEqual({
      record: true,
      extraArgs: [],
      reason: 'full-suite',
    });
  });

  it('skips recording when a file filter is forwarded', () => {
    expect(decideRecording(['src/foo.test.ts'], {})).toEqual({
      record: false,
      extraArgs: ['src/foo.test.ts'],
      reason: 'filtered',
    });
  });

  it('skips recording for forwarded flags too (canonical flags are never forwarded)', () => {
    expect(decideRecording(['--', '--reporter=json'], {})).toEqual({
      record: false,
      extraArgs: ['--reporter=json'],
      reason: 'filtered',
    });
  });

  // Why: the timing tables come from runs on main only, so the runner records
  // when ci.yml asks for it there and in no other run. A filtered run is not
  // the suite on any machine.
  it('records on the GitHub runner only when the run asks for it', () => {
    const env = { GITHUB_ACTIONS: 'true', TIMING_RECORD_ON_RUNNER: '1' };
    expect(decideRecording([], env).record).toBe(true);
    expect(decideRecording(['src/a.test.ts'], env).record).toBe(false);
    expect(decideRecording([], { ...env, TIMING_RECORD_ON_RUNNER: '' }).record).toBe(false);
  });

  it('never records on the GitHub runner, even for full-suite runs', () => {
    expect(decideRecording([], { GITHUB_ACTIONS: 'true', CI: 'true' })).toEqual({
      record: false,
      extraArgs: [],
      reason: 'ci',
    });
  });

  it('records a local gate run that sets CI=1', () => {
    // Every local gate sets CI=1 (for Playwright's CI mode), so keying the skip
    // on CI recorded no gate run from 2026-09-30 on (when CI=1 entered the
    // commit gate) and the versioned test-timings.md files went stale. Only the
    // GitHub runner counts as CI here.
    expect(decideRecording([], { CI: '1' })).toEqual({
      record: true,
      extraArgs: [],
      reason: 'full-suite',
    });
  });

  it('treats an empty GITHUB_ACTIONS variable as not the runner', () => {
    expect(decideRecording([], { GITHUB_ACTIONS: '' }).record).toBe(true);
  });
});

describe('appendArgs', () => {
  it('returns the command unchanged when there are no extra args', () => {
    expect(appendArgs('vitest run --coverage', [])).toBe(
      'vitest run --coverage'
    );
  });

  it('appends plain args space-separated', () => {
    expect(appendArgs('vitest run', ['src/foo.test.ts', '-t', 'name'])).toBe(
      'vitest run src/foo.test.ts -t name'
    );
  });

  it('double-quotes args containing whitespace', () => {
    expect(appendArgs('vitest run', ['src/my tests/a.test.ts'])).toBe(
      'vitest run "src/my tests/a.test.ts"'
    );
  });

  it('escapes embedded double quotes', () => {
    expect(appendArgs('cmd', ['say "hi"'])).toBe('cmd "say \\"hi\\""');
  });
});

// Why these tests matter: filtered runs previously exited 1 from the GLOBAL
// coverage thresholds even when every test passed (vitest computes them
// against all of src/ while only one file's tests ran), making single-file
// TDD exit codes lie. The fix appends per-stage filteredRunArgs (threshold
// neutralizers) on filtered runs ONLY — full-suite and CI runs must keep the
// canonical command byte-identical so thresholds stay enforced where they
// are meaningful.
describe('buildStageCommand', () => {
  const CMD = 'vitest run --coverage --config config/vitest.config.ts';
  const NEUTRALIZERS = [
    '--coverage.thresholds.statements=0',
    '--coverage.thresholds.branches=0',
  ];

  it('keeps the canonical command byte-identical for a full-suite run', () => {
    const decision = decideRecording([], {});
    expect(buildStageCommand(CMD, decision, NEUTRALIZERS)).toBe(CMD);
  });

  it('keeps the canonical command byte-identical for an unfiltered CI run (CI keeps enforcing thresholds)', () => {
    const decision = decideRecording([], { GITHUB_ACTIONS: 'true' });
    expect(buildStageCommand(CMD, decision, NEUTRALIZERS)).toBe(CMD);
  });

  it('inserts the filtered-run args before the forwarded filter on filtered runs', () => {
    const decision = decideRecording(['--', 'src/foo.test.ts'], {});
    expect(buildStageCommand(CMD, decision, NEUTRALIZERS)).toBe(
      `${CMD} --coverage.thresholds.statements=0 --coverage.thresholds.branches=0 src/foo.test.ts`
    );
  });

  it('keeps forwarded args last, so an explicitly forwarded flag can still override a neutralizer', () => {
    const decision = decideRecording(
      ['--coverage.thresholds.statements=50'],
      {}
    );
    expect(buildStageCommand(CMD, decision, NEUTRALIZERS)).toBe(
      `${CMD} --coverage.thresholds.statements=0 --coverage.thresholds.branches=0 --coverage.thresholds.statements=50`
    );
  });

  it('appends just the forwarded args when the stage declares no filtered-run args', () => {
    const decision = decideRecording(['src/foo.test.ts'], {});
    expect(buildStageCommand(CMD, decision)).toBe(`${CMD} src/foo.test.ts`);
  });
});

// Why these tests matter: coverage collection is a large share of a filtered
// unit run's wall-clock, but its repo-wide numbers are meaningless when only
// one file's tests ran (speedup plan Phase C.1, decided 2026-07-21). A stage
// may therefore declare a filteredRunCommand — a cheaper command substituted
// ONLY on filtered runs. Recorded full-suite runs and unfiltered CI runs
// must keep the canonical command byte-identical: recorded durations always
// include coverage, and thresholds stay enforced where they are meaningful.
describe('buildStageCommand with filteredRunCommand', () => {
  const CMD = 'vitest run --coverage --config config/vitest.config.ts';
  const FAST = 'vitest run --config config/vitest.config.ts';

  it('substitutes the filtered-run command on filtered runs', () => {
    const decision = decideRecording(['src/foo.test.ts'], {});
    expect(buildStageCommand(CMD, decision, [], FAST)).toBe(
      `${FAST} src/foo.test.ts`
    );
  });

  it('keeps the canonical command for full-suite runs', () => {
    const decision = decideRecording([], {});
    expect(buildStageCommand(CMD, decision, [], FAST)).toBe(CMD);
  });

  it('keeps the canonical command for unfiltered CI runs', () => {
    const decision = decideRecording([], { GITHUB_ACTIONS: 'true' });
    expect(buildStageCommand(CMD, decision, [], FAST)).toBe(CMD);
  });

  it('uses the filtered-run command for CI runs WITH a file filter', () => {
    const decision = decideRecording(['src/foo.test.ts'], { GITHUB_ACTIONS: 'true' });
    expect(buildStageCommand(CMD, decision, [], FAST)).toBe(
      `${FAST} src/foo.test.ts`
    );
  });

  it('combines filteredRunArgs with the filtered-run command', () => {
    const decision = decideRecording(['src/foo.test.ts'], {});
    expect(buildStageCommand(CMD, decision, ['--silent=false'], FAST)).toBe(
      `${FAST} --silent=false src/foo.test.ts`
    );
  });
});
