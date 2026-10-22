// Why this test matters: the watchdog must fire on a stage that is SILENT,
// never on one that is merely SLOW, must stay out of the nested package-gate
// stages so the leaf that hangs is the one named, and must leave a filtered
// run alone unless it opts in (a filtered investigation sweep under CI=1 can
// print nothing for 25 minutes and is healthy). Its banner must not claim a
// kill that failed, and must not send the reader looking for a shrinking
// property, which the fast-check time limit already stops. These pin the
// pure half; stall-watch.integration.test.mjs drives the spawning half.
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_STALL_MIN,
  STALL_EXIT,
  STALL_POLL_MS,
  STALL_SUMMARY,
  parseWatchLine,
  shouldReportSilence,
  silenceClock,
  silenceLine,
  stallLimitMs,
  stallMessage,
  stallPollMs,
  watchLine,
} from './stall-watch.mjs';

const DEFAULT_MS = DEFAULT_STALL_MIN * 60_000;

describe('stallLimitMs', () => {
  it('defaults to 20 min for an unfiltered leaf stage', () => {
    expect(DEFAULT_STALL_MIN).toBe(20);
    expect(stallLimitMs({}, {})).toBe(DEFAULT_MS);
  });

  it('never watches a nested package gate', () => {
    expect(stallLimitMs({ nestedGate: true }, {})).toBeNull();
    expect(stallLimitMs({ nestedGate: true }, { GATE_STALL_MIN: '5' })).toBeNull();
  });

  it('is switched off by GATE_STALL_MIN=off, in any case', () => {
    expect(stallLimitMs({}, { GATE_STALL_MIN: 'off' })).toBeNull();
    expect(stallLimitMs({}, { GATE_STALL_MIN: ' OFF ' })).toBeNull();
  });

  it('takes the env over the stage, and the stage over the default', () => {
    expect(stallLimitMs({ stallMinutes: 40 }, { GATE_STALL_MIN: '5' })).toBe(300_000);
    expect(stallLimitMs({ stallMinutes: 40 }, {})).toBe(2_400_000);
    expect(stallLimitMs({}, { GATE_STALL_MIN: '0.05' })).toBe(3_000);
  });

  it('falls back on a malformed or non-positive value rather than switching off', () => {
    for (const bad of ['', '  ', 'abc', '0', '-3', 'Infinity']) {
      expect(stallLimitMs({}, { GATE_STALL_MIN: bad })).toBe(DEFAULT_MS);
    }
    for (const bad of [0, -1, Number.NaN]) {
      expect(stallLimitMs({ stallMinutes: bad }, {})).toBe(DEFAULT_MS);
    }
  });

  it('leaves a filtered run alone unless GATE_STALL_MIN opts it in', () => {
    expect(stallLimitMs({}, {}, { filtered: true })).toBeNull();
    expect(stallLimitMs({ stallMinutes: 40 }, {}, { filtered: true })).toBeNull();
    expect(stallLimitMs({}, { GATE_STALL_MIN: 'abc' }, { filtered: true })).toBeNull();
    expect(stallLimitMs({}, { GATE_STALL_MIN: '30' }, { filtered: true })).toBe(1_800_000);
    expect(stallLimitMs({}, { GATE_STALL_MIN: 'off' }, { filtered: true })).toBeNull();
  });
});

describe('stallPollMs', () => {
  it('defaults to the poll constant and accepts a positive override', () => {
    expect(stallPollMs({})).toBe(STALL_POLL_MS);
    expect(stallPollMs({ GATE_STALL_POLL_MS: '200' })).toBe(200);
    expect(stallPollMs({ GATE_STALL_POLL_MS: '0' })).toBe(STALL_POLL_MS);
    expect(stallPollMs({ GATE_STALL_POLL_MS: 'x' })).toBe(STALL_POLL_MS);
  });
});

describe('silenceClock', () => {
  it('stalls only once the silence reaches the limit, and output resets it', () => {
    const clock = silenceClock(1_000, 0);
    expect(clock.check(999).stalled).toBe(false);
    clock.heard(999);
    expect(clock.check(1_998).stalled).toBe(false);
    expect(clock.check(1_999).stalled).toBe(true);
  });

  it('reports the longest silence, including the open one', () => {
    const clock = silenceClock(10_000, 0);
    clock.heard(300);
    clock.heard(2_300);
    expect(clock.longest(2_400)).toBe(2_000);
    expect(clock.longest(5_000)).toBe(2_700);
  });

  it('does not move backwards on an out-of-order timestamp', () => {
    const clock = silenceClock(1_000, 0);
    clock.heard(500);
    clock.heard(400);
    expect(clock.check(1_499).stalled).toBe(false);
    expect(clock.check(1_500).stalled).toBe(true);
  });
});

describe('the calibration line', () => {
  it('is printed only past a quarter of the limit', () => {
    // A healthy cascade's longest silence was 58 s; at the 20 min default
    // the line starts at 5 min, so it never fires on a healthy stage.
    expect(shouldReportSilence(58_000, DEFAULT_MS)).toBe(false);
    expect(shouldReportSilence(DEFAULT_MS / 4, DEFAULT_MS)).toBe(false);
    expect(shouldReportSilence(DEFAULT_MS / 4 + 1, DEFAULT_MS)).toBe(true);
  });

  it('names the stage and both durations', () => {
    expect(silenceLine('GpsPlusSlamJs_AppFramework lint', 6 * 60_000, 9 * 60_000)).toBe(
      '⏱ longest silence in GpsPlusSlamJs_AppFramework lint: 6.0 min of 9.0 min (a stage is killed at GATE_STALL_MIN)'
    );
  });
});

describe('stallMessage', () => {
  const name = 'GpsPlusSlamJs_Globe test:unit';

  it('says STALLED, names the stage, the silence and exit 124', () => {
    const text = stallMessage(name, 20 * 60_000, { killed: true });
    expect(text).toContain(`✖ STALLED: stage "${name}" printed nothing for 20.0 min`);
    expect(text).toContain(`its process tree was killed (exit ${STALL_EXIT})`);
    expect(STALL_EXIT).toBe(124);
  });

  it('points at a real hang and a per-file reporter, not at a shrinking property', () => {
    const text = stallMessage(name, 20 * 60_000, { killed: true });
    expect(text).toContain('not a failing property still shrinking');
    expect(text).toContain('a real hang');
    expect(text).toContain('keeping CI=1');
    // The reader must be told the command that works: a filtered run skips
    // the machine slot unless asked, and pnpm forwards the reporter flag
    // without a separating "--".
    expect(text).toContain('for a vitest stage');
    expect(text).toContain('GATE_SLOT=take');
    expect(text).toContain('pnpm run test:unit --reporter=verbose');
    expect(text).not.toContain('test:unit -- ');
    expect(text).toContain('Do not retry it away');
    // An earlier wording said this; with the property limit in place a
    // stall is no longer a test failure in disguise, but it is not a pass.
    expect(text).not.toContain('not a test failure');
  });

  it('never claims a kill that failed', () => {
    const text = stallMessage(name, 20 * 60_000, { killed: false, error: 'EPERM' });
    expect(text).not.toContain('was killed');
    expect(text).toContain('killing its process tree FAILED (EPERM)');
    expect(text).toContain('may still be running');
  });
});

// Why: the gate's waiter sizes its quiet window from the limit the GATE ran
// with, not from its own environment, so the gate writes that limit into its
// log and the waiter reads it back. One format, written and parsed here.
describe('watchLine and parseWatchLine', () => {
  it('states the effective limit, and reads it back', () => {
    expect(watchLine({})).toBe(
      'stage watchdog: 20 min (GATE_STALL_MIN; a stage silent that long is killed, exit 124)'
    );
    expect(parseWatchLine(watchLine({}))).toEqual({ minutes: 20 });
    expect(parseWatchLine(watchLine({ GATE_STALL_MIN: '7.5' }))).toEqual({ minutes: 7.5 });
  });

  it('states and reads a switched-off watch', () => {
    expect(watchLine({ GATE_STALL_MIN: 'OFF' })).toBe('stage watchdog: off (GATE_STALL_MIN=off)');
    expect(parseWatchLine(watchLine({ GATE_STALL_MIN: 'off' }))).toEqual({ off: true });
  });

  it('a malformed value states the default it falls back to', () => {
    expect(parseWatchLine(watchLine({ GATE_STALL_MIN: 'soon' }))).toEqual({ minutes: 20 });
  });

  // Why: in a run whose output is a terminal no stage is piped, so nothing
  // is watched (run-stage.mjs). A line claiming a live limit would tell the
  // reader a hung stage will be killed when it will not be, and would make
  // wait-gate.mjs report a quiet log as "wedged outside a stage".
  it('states the watch is off when the run is not watched, whatever the limit', () => {
    for (const env of [{}, { GATE_STALL_MIN: '7' }, { GATE_STALL_MIN: 'off' }]) {
      const line = watchLine(env, { watched: false });
      expect(line).toBe('stage watchdog: off (output is a terminal, so no stage is watched)');
      expect(parseWatchLine(line)).toEqual({ off: true });
    }
    expect(watchLine({ GATE_STALL_MIN: '7' }, { watched: true })).toBe(
      watchLine({ GATE_STALL_MIN: '7' })
    );
  });

  it('takes the LAST whole line, and nothing when there is none', () => {
    const log = [
      'x',
      watchLine({ GATE_STALL_MIN: '30' }),
      'y',
      watchLine({ GATE_STALL_MIN: '9' }),
    ].join('\n');
    expect(parseWatchLine(log)).toEqual({ minutes: 9 });
    expect(parseWatchLine('echo stage watchdog: 3 min (x)\n')).toBeNull();
    expect(parseWatchLine('')).toBeNull();
  });
});

// Why: the one-line verdict a gate prints after a stage was killed is what a
// reader skimming the end of a log sees. It must not read the variable's
// NAME as a number of minutes (the limit can differ per stage, or be off),
// and must keep naming where the limit comes from.
describe('STALL_SUMMARY', () => {
  it('names the limit by its source, never as a duration', () => {
    expect(STALL_SUMMARY).not.toMatch(/GATE_STALL_MIN minutes/);
    expect(STALL_SUMMARY).toContain('longer than its watchdog limit (set by GATE_STALL_MIN)');
    expect(STALL_SUMMARY).toContain('Not a red test; do not retry it away.');
  });
});
