// Why this test matters: the waiter's one background wait is the net for a
// hang the stage watchdog cannot see (the framework build, an install, a run
// with the watch off). It must return on the gate's own GATE-RC line with
// that exit code, must return on a quiet log only after the watchdog's limit
// plus a margin (so the watchdog always gets to fire first), must name the
// machine slot's holder and the action instead of a bare "quiet", and must
// refuse a longer window that does not say which long run it is for.
import { spawn } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { REMIND_EVERY_MS } from './machine-slot.mjs';
import { watchLine } from './stall-watch.mjs';
import {
  ALREADY_DONE_EXIT,
  QUIET_EXIT,
  USAGE_EXIT,
  decideWait,
  gateRc,
  parseWaitArgs,
  quietReport,
  quietWindow,
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

describe('quietWindow', () => {
  it('is the watchdog limit plus 5 min: 25 min by default', () => {
    expect(quietWindow({}, null, '')).toEqual({ ms: 25 * 60_000, basis: 'env' });
    expect(quietWindow({ GATE_STALL_MIN: '30' }, null, '').ms).toBe(35 * 60_000);
  });

  it('falls back to the default limit when the watch is off or malformed', () => {
    expect(quietWindow({ GATE_STALL_MIN: 'off' }, null, '').ms).toBe(25 * 60_000);
    expect(quietWindow({ GATE_STALL_MIN: '-1' }, null, '').ms).toBe(25 * 60_000);
  });

  it('takes the named override as given', () => {
    expect(quietWindow({ GATE_STALL_MIN: '30' }, 90, '')).toEqual({ ms: 90 * 60_000, basis: 'named' });
  });

  // Why: the wait runs in its own shell, so its GATE_STALL_MIN need not be
  // the gate's. A gate run with a 40 min limit, waited on with a 25 min
  // window, would be reported quiet while the watchdog was still entitled to
  // wait; so the gate's own statement in the log wins over this environment.
  it("takes the limit the gate wrote into its log over the wait's own", () => {
    const log = `queued\n${watchLine({ GATE_STALL_MIN: '40' })}\nstage output\n`;
    expect(quietWindow({ GATE_STALL_MIN: '10' }, null, log)).toEqual({ ms: 45 * 60_000, basis: 'log' });
    const off = `${watchLine({ GATE_STALL_MIN: 'off' })}\n`;
    expect(quietWindow({ GATE_STALL_MIN: '10' }, null, off)).toEqual({ ms: 25 * 60_000, basis: 'log-off' });
    // A run whose output was a terminal watched nothing, whatever its limit:
    // the report must not claim the gate would have killed a hung stage.
    const unwatched = `${watchLine({ GATE_STALL_MIN: '40' }, { watched: false })}\n`;
    expect(quietWindow({ GATE_STALL_MIN: '10' }, null, unwatched)).toEqual({ ms: 25 * 60_000, basis: 'log-off' });
    expect(quietWindow({}, 90, log).basis).toBe('named');
  });

  // Why: a gate queued for the machine slot prints nothing but the slot's
  // "still queued" reminder. If that reminder came less often than the quiet
  // window, a long queue would read as a hang and the waiter would return
  // "quiet" on a healthy gate. The default window must leave a wide margin.
  it('is far longer than the gap between two queue reminders', () => {
    expect(quietWindow({}, null, '').ms).toBeGreaterThanOrEqual(4 * REMIND_EVERY_MS);
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
  const base = {
    log: 'g.log',
    silentMs: 26 * 60_000,
    window: { ms: 25 * 60_000, basis: /** @type {const} */ ('log') },
    longRun: null,
    nowMs: Date.UTC(2026, 9, 21, 18, 0),
  };
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

  // Why: the report must not claim more than it knows. Only when the gate's
  // own log states a live watchdog limit is "a hang inside a stage would have
  // been killed already" true.
  it('says where the hang can be only as far as the log shows it', () => {
    const slot = { dir: null, present: false, existing: null };
    const known = quietReport({ ...base, slot, platform: 'win32' });
    expect(known).toContain('its log says so');
    expect(known).toContain('outside a stage');
    const off = quietReport({ ...base, window: { ms: 25 * 60_000, basis: 'log-off' }, slot, platform: 'win32' });
    expect(off).toContain('watchdog is off');
    expect(off).not.toContain('its log says so');
    const env = quietReport({ ...base, window: { ms: 25 * 60_000, basis: 'env' }, slot, platform: 'win32' });
    expect(env).toContain("does not say the gate's watchdog limit");
    expect(env).not.toContain('its log says so');
    const named = quietReport({
      ...base,
      window: { ms: 60 * 60_000, basis: 'named' },
      longRun: 'seed sweep',
      slot,
      platform: 'win32',
    });
    expect(named).toContain('"seed sweep"');
    expect(named).not.toContain('its log says so');
  });

  it('says so when the slot is off, free, or has no record', () => {
    expect(quietReport({ ...base, slot: { dir: null, present: false, existing: null }, platform: 'win32' })).toContain('Machine slot: off');
    expect(quietReport({ ...base, slot: { dir: 'd', present: false, existing: null }, platform: 'win32' })).toContain('Machine slot: free');
    expect(quietReport({ ...base, slot: { dir: 'd', present: true, existing: null }, platform: 'win32' })).toContain('no readable owner record');
  });
});

describe('the CLI', { timeout: 30_000 }, () => {
  /** @type {string[]} */
  const dirs = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /**
   * @param {string[]} args
   * @param {Record<string, string>} env
   * @param {() => void} [onWaiting] - called once the wait has said it waits
   * @returns {Promise<{ code: number | null, out: string }>}
   */
  const run = (args, env, onWaiting) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, ...args], {
        env: { ...process.env, WAIT_GATE_POLL_MS: '50', ...env },
      });
      let out = '';
      child.stdout.on('data', (chunk) => {
        out += chunk;
        if (onWaiting && out.includes('wait-gate: waiting on')) {
          onWaiting();
          onWaiting = undefined;
        }
      });
      child.stderr.on('data', (chunk) => (out += chunk));
      child.on('exit', (code) => resolve({ code, out }));
    });

  /** @returns {string} a fresh temp dir, removed after the test */
  const tempDir = () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'wait-gate-'));
    dirs.push(dir);
    return dir;
  };

  /** Sets a file's mtime `minutes` before the moment it was written. */
  const age = (/** @type {string} */ file, /** @type {number} */ minutes) => {
    const then = (statSync(file).mtimeMs - minutes * 60_000) / 1000;
    utimesSync(file, then, then);
  };

  it('returns with the gate exit code once the GATE-RC line is there', async () => {
    const log = path.join(tempDir(), 'g.log');
    writeFileSync(log, 'stage output\n');
    // Appended only once the wait runs: a line already there is refused.
    const { code, out } = await run([log], { GATE_SLOT_DIR: 'off' }, () =>
      appendFileSync(log, 'GATE-RC=124\n')
    );
    expect(code).toBe(124);
    expect(out).toContain('wait-gate: GATE-RC=124');
  });

  // Why: a GATE-RC line already in the log when the wait starts belongs to a
  // run that has finished: this one between two waits, or an earlier run
  // whose log was reused. Returning its code could pass a gate that never
  // ran; the wait names the code and both readings, and returns its own exit.
  it('refuses a log that already holds a GATE-RC line, naming its code', async () => {
    const log = path.join(tempDir(), 'g.log');
    writeFileSync(log, 'stage output\nGATE-RC=0\n');
    const { code, out } = await run([log], { GATE_SLOT_DIR: 'off' });
    expect(code).toBe(ALREADY_DONE_EXIT);
    expect(out).toContain('already holds GATE-RC=0');
    expect(out).not.toContain('wait-gate: GATE-RC=0 (');
  });

  // Why: a harness cuts a background wait after about 30 min, and the wait
  // is started again. Counting the silence from each start would mean a
  // window of 30 min or more could never be reached; it counts from the
  // log's own last change.
  it('counts the silence from the log, so a re-armed wait on a quiet log returns at once', async () => {
    const log = path.join(tempDir(), 'g.log');
    writeFileSync(log, 'stage output, then nothing\n');
    age(log, 61);
    const { code, out } = await run([log, '--long-run', 'seed sweep', '--quiet-min', '60'], {
      GATE_SLOT_DIR: 'off',
    });
    expect(code).toBe(QUIET_EXIT);
    expect(out).toContain('has not changed for 61.');
  });

  it("sizes the window from the gate's log line, not from its own environment", async () => {
    const log = path.join(tempDir(), 'g.log');
    // The gate ran with a 1 min limit (window 6 min); the wait's own env says
    // 20 (window 25). Quiet for 7 min is past the first and short of the second.
    writeFileSync(log, `${watchLine({ GATE_STALL_MIN: '1' })}\n`);
    age(log, 7);
    const { code, out } = await run([log], { GATE_SLOT_DIR: 'off', GATE_STALL_MIN: '20' });
    expect(code).toBe(QUIET_EXIT);
    expect(out).toContain('its log says so');
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
    // Not 2, which a gate itself can return (a lint or tsc failure).
    expect(code).toBe(USAGE_EXIT);
    expect(USAGE_EXIT).toBe(64);
    expect(out).toContain('--long-run and --quiet-min go together');
  });
});
