// Why this test matters: the waiter's one background wait is the net for a
// hang the stage watchdog cannot see (the framework build, an install, a run
// with the watch off). It must return on the gate's own GATE-RC line with
// that exit code, must return on a quiet log only after the watchdog's limit
// plus a margin (so the watchdog always gets to fire first), must name the
// machine slot's holder and the action instead of a bare "quiet", and must
// refuse a longer window that does not say which long run it is for.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { REMIND_EVERY_MS } from './machine-slot.mjs';
import {
  QUIET_EXIT,
  decideWait,
  gateRc,
  parseWaitArgs,
  quietReport,
  quietWindowMs,
} from './wait-gate.mjs';

const SCRIPT = fileURLToPath(new URL('./wait-gate.mjs', import.meta.url));

describe('parseWaitArgs', () => {
  it('takes a log alone', () => {
    expect(parseWaitArgs(['gate.log'])).toEqual({ log: 'gate.log', longRun: null, quietMin: null });
  });

  it('takes a longer window only with the name of the long run', () => {
    expect(parseWaitArgs(['gate.log', '--long-run', 'seed sweep', '--quiet-min', '60'])).toEqual({
      log: 'gate.log',
      longRun: 'seed sweep',
      quietMin: 60,
    });
    expect(parseWaitArgs(['gate.log', '--quiet-min', '60'])).toHaveProperty('error');
    expect(parseWaitArgs(['gate.log', '--long-run', 'seed sweep'])).toHaveProperty('error');
  });

  it('rejects a missing log, an empty name, a bad window and stray args', () => {
    for (const argv of [
      [],
      ['gate.log', '--long-run', ' ', '--quiet-min', '5'],
      ['gate.log', '--long-run', 'x', '--quiet-min', '0'],
      ['gate.log', '--long-run', 'x', '--quiet-min', 'soon'],
      ['gate.log', 'other.log'],
      ['gate.log', '--watch'],
    ]) {
      expect(parseWaitArgs(argv)).toHaveProperty('error');
    }
  });
});

describe('quietWindowMs', () => {
  it('is the watchdog limit plus 5 min: 25 min by default', () => {
    expect(quietWindowMs({}, null)).toBe(25 * 60_000);
    expect(quietWindowMs({ GATE_STALL_MIN: '30' }, null)).toBe(35 * 60_000);
  });

  it('falls back to the default limit when the watch is off or malformed', () => {
    expect(quietWindowMs({ GATE_STALL_MIN: 'off' }, null)).toBe(25 * 60_000);
    expect(quietWindowMs({ GATE_STALL_MIN: '-1' }, null)).toBe(25 * 60_000);
  });

  it('takes the named override as given', () => {
    expect(quietWindowMs({ GATE_STALL_MIN: '30' }, 90)).toBe(90 * 60_000);
  });

  // Why: a gate queued for the machine slot prints nothing but the slot's
  // "still queued" reminder. If that reminder came less often than the quiet
  // window, a long queue would read as a hang and the waiter would return
  // "quiet" on a healthy gate. The default window must leave a wide margin.
  it('is far longer than the gap between two queue reminders', () => {
    expect(quietWindowMs({}, null)).toBeGreaterThanOrEqual(4 * REMIND_EVERY_MS);
  });
});

describe('gateRc and decideWait', () => {
  it('reads the last GATE-RC line, and only a whole line', () => {
    expect(gateRc('a\nGATE-RC=1\nb\nGATE-RC=124\n')).toBe(124);
    expect(gateRc('echo GATE-RC=0 >> log\n')).toBeNull();
    expect(gateRc('nothing yet')).toBeNull();
  });

  it('is done on a GATE-RC line however quiet the log', () => {
    expect(decideWait({ rc: 0, lastChangeMs: 0, nowMs: 10 ** 9, quietMs: 1 })).toEqual({
      state: 'done',
      rc: 0,
    });
  });

  it('waits until the window has passed, then reports quiet', () => {
    expect(decideWait({ rc: null, lastChangeMs: 0, nowMs: 999, quietMs: 1_000 })).toEqual({
      state: 'wait',
    });
    expect(decideWait({ rc: null, lastChangeMs: 0, nowMs: 1_000, quietMs: 1_000 })).toEqual({
      state: 'quiet',
      silentMs: 1_000,
    });
  });
});

describe('quietReport', () => {
  const base = { log: 'g.log', silentMs: 26 * 60_000, quietMs: 25 * 60_000, nowMs: Date.UTC(2026, 9, 21, 18, 0) };
  const holder = {
    pid: 16292,
    token: 't',
    startedAt: Date.UTC(2026, 9, 21, 15, 45),
    command: 'test:changed in C:\\gps\\wt-x',
  };

  it('names the holder and the action, and says not to relaunch', () => {
    const text = quietReport({
      ...base,
      slot: { dir: 'C:\\gps\\.e2e-slots\\gate', present: true, existing: holder },
      platform: 'win32',
    });
    expect(text).toContain('✖ QUIET: g.log has not changed for 26.0 min (window 25.0 min)');
    expect(text).toContain('held by pid 16292');
    expect(text).toContain('taskkill /PID 16292 /T /F');
    expect(text).toContain("if it is another\n  session's, report it and leave it alone");
    expect(text).toContain('Do NOT relaunch a gate');
  });

  it('gives a POSIX action off Windows', () => {
    const text = quietReport({
      ...base,
      slot: { dir: '/slots/gate', present: true, existing: holder },
      platform: 'linux',
    });
    expect(text).toContain('kill -TERM 16292');
    expect(text).not.toContain('taskkill');
  });

  it('says so when the slot is off, free, or has no record', () => {
    expect(quietReport({ ...base, slot: { dir: null, present: false, existing: null }, platform: 'win32' })).toContain('Machine slot: off');
    expect(quietReport({ ...base, slot: { dir: 'd', present: false, existing: null }, platform: 'win32' })).toContain('Machine slot: free');
    expect(quietReport({ ...base, slot: { dir: 'd', present: true, existing: null }, platform: 'win32' })).toContain('no readable owner record');
  });
});

describe('the CLI', () => {
  /** @type {string[]} */
  const dirs = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /**
   * @param {string[]} args
   * @param {Record<string, string>} env
   * @returns {Promise<{ code: number | null, out: string }>}
   */
  const run = (args, env) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, ...args], {
        env: { ...process.env, WAIT_GATE_POLL_MS: '50', ...env },
      });
      let out = '';
      child.stdout.on('data', (chunk) => (out += chunk));
      child.stderr.on('data', (chunk) => (out += chunk));
      child.on('exit', (code) => resolve({ code, out }));
    });

  it('returns with the gate exit code once the GATE-RC line is there', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'wait-gate-'));
    dirs.push(dir);
    const log = path.join(dir, 'g.log');
    writeFileSync(log, 'stage output\nGATE-RC=124\n');
    const { code, out } = await run([log], { GATE_SLOT_DIR: 'off' });
    expect(code).toBe(124);
    expect(out).toContain('wait-gate: GATE-RC=124');
  });

  it('returns QUIET with the slot holder when a named window passes', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'wait-gate-'));
    dirs.push(dir);
    const log = path.join(dir, 'g.log');
    writeFileSync(log, 'stage output, then nothing\n');
    const slot = path.join(dir, 'slot');
    mkdirSync(slot);
    writeFileSync(
      path.join(slot, 'owner.json'),
      JSON.stringify({ pid: 4242, token: 't', startedAt: Date.now(), command: 'pnpm test in X' })
    );
    // 0.005 min = 300 ms
    const { code, out } = await run([log, '--long-run', 'fixture', '--quiet-min', '0.005'], {
      GATE_SLOT_DIR: slot,
    });
    expect(code).toBe(QUIET_EXIT);
    expect(out).toContain('(long run: fixture)');
    expect(out).toContain('✖ QUIET');
    expect(out).toContain('held by pid 4242');
  });

  it('refuses an unnamed longer window with a usage error', async () => {
    const { code, out } = await run(['g.log', '--quiet-min', '60'], { GATE_SLOT_DIR: 'off' });
    expect(code).toBe(2);
    expect(out).toContain('--long-run and --quiet-min go together');
  });
});
