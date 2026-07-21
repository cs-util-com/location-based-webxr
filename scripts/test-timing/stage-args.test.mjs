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

  it('never records on CI, even for full-suite runs', () => {
    expect(decideRecording([], { CI: 'true' })).toEqual({
      record: false,
      extraArgs: [],
      reason: 'ci',
    });
  });

  it('treats an empty CI env var as not-CI (matches common CI detection)', () => {
    expect(decideRecording([], { CI: '' }).record).toBe(true);
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
    const decision = decideRecording([], { CI: 'true' });
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
