// Why this test matters: the watchdog's whole value is in its spawning half,
// which no pure test reaches. A silent stage must be killed with its whole
// process tree, including a forked grandchild (a vitest worker busy in a
// shrink is exactly such a grandchild), and must exit 124 with the banner; a
// slow stage that keeps talking must never be killed. On POSIX a signal to
// the gate must reach the stage's own process group too, since the stage
// runs detached there, and before the machine slot's own handler exits. Real processes, a tiny limit and a short poll; it runs
// on Windows locally and on Linux in CI.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { STALL_EXIT } from './stall-watch.mjs';

const DRIVER = fileURLToPath(
  new URL('./__test-fixtures__/stall-watch/run-fixture-stage.mjs', import.meta.url)
);

/** @param {number} pid @returns {boolean} */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === 'EPERM';
  }
}

/** Resolves once `pid` is gone, or after `tries` short waits. */
async function gone(/** @type {number} */ pid, tries = 40) {
  for (let i = 0; i < tries && alive(pid); i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !alive(pid);
}

/** @param {string} file @returns {number | null} */
function pidIn(file) {
  try {
    const pid = Number(readFileSync(file, 'utf8'));
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null; // not written yet
  }
}

/**
 * Resolves once the file holds a pid, waiting as long as the driver lives
 * (a loaded machine can take seconds to start it; the test's own timeout
 * bounds the wait), and fails once the driver ended without writing one,
 * or once `signal` aborts (the test's own, aborted on its timeout).
 * @param {string} file
 * @param {import('node:child_process').ChildProcess} driver
 * @param {AbortSignal} signal
 */
async function readPid(file, driver, signal) {
  for (;;) {
    signal.throwIfAborted();
    const ended = driver.exitCode !== null || driver.signalCode !== null;
    const pid = pidIn(file);
    if (pid !== null) return pid;
    if (ended) throw new Error(`no pid in ${file}, and the driver ended`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** @type {string[]} */
const dirs = [];
/** @type {number[]} */
const leftovers = [];
/** Every driver spawned, stopped after its test if still running.
 *  @type {import('node:child_process').ChildProcess[]} */
const drivers = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) {
    if (driver.exitCode === null && driver.signalCode === null) driver.kill('SIGKILL');
  }
  for (const pid of leftovers.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone, which is the point
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * @param {string} stage
 * @param {string} limitMin
 * @param {string} [pidFile]
 * @param {string} [mode] - "natural": the driver ends without process.exit
 */
function drive(stage, limitMin, pidFile = '', mode = '') {
  const child = spawn(process.execPath, [DRIVER, stage, pidFile, mode], {
    // A pipe, not a terminal, as in every detached gate run: the watch is on.
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CI: '1',
      // The fixture's stages must never write a timings file into the
      // fixture dir: since recording keys on the GitHub runner, CI=1 alone
      // no longer stops it.
      GITHUB_ACTIONS: 'true',
      GATE_STALL_MIN: limitMin,
      GATE_STALL_POLL_MS: '100',
      GATE_STALL_REPORT_GRACE_MS: '500',
      GATE_SLOT_DIR: 'off',
    },
  });
  drivers.push(child);
  let out = '';
  child.stdout.on('data', (chunk) => (out += chunk));
  child.stderr.on('data', (chunk) => (out += chunk));
  const done = new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal, out }));
  });
  return { child, done: /** @type {Promise<{ code: number | null, signal: string | null, out: string }>} */ (done) };
}

describe('the test helpers', () => {
  // Why: a test that times out while readPid waits must not leave the wait
  // polling, nor its driver running: both outlived the test before, and a
  // driver left alive holds its fixture processes. The test's abort signal
  // ends the wait; afterEach stops the driver.
  it('stops waiting for a pid once the test is aborted', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'stall-watch-'));
    dirs.push(dir);
    // The talker never writes the pid file, so only the abort ends the wait.
    const { child } = drive('talker', '0.1667', path.join(dir, 'never.pid'));
    const abort = new AbortController();
    setTimeout(() => abort.abort(new Error('test timed out')), 200);
    await expect(readPid(path.join(dir, 'never.pid'), child, abort.signal)).rejects.toThrow(
      'test timed out'
    );
  }, 30_000);
});

describe('the stage watchdog, end to end', () => {
  it('kills a silent stage and its forked grandchild, and exits 124', async ({ signal }) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'stall-watch-'));
    dirs.push(dir);
    const pidFile = path.join(dir, 'grandchild.pid');
    // 0.02 min = 1.2 s of silence.
    const { child, done } = drive('silent', '0.02', pidFile);
    const grandchild = await readPid(pidFile, child, signal);
    leftovers.push(grandchild);

    const { code, out } = await done;
    expect(code).toBe(STALL_EXIT);
    expect(out).toContain('✖ STALLED: stage "stall-fixture silent" printed nothing for');
    expect(out).toContain('its process tree was killed (exit 124)');
    expect(out).toContain('RESULT exit=124');
    expect(await gone(grandchild)).toBe(true);
  }, 30_000);

  // Why: on POSIX the killed stage's `exit` usually arrives before the kill
  // helper returns (it polls the group in 100 ms steps), so the 10 s cap on
  // waiting for that `exit` must not be armed once the stage has settled: it
  // would hold the caller's event loop for 10 s after the verdict. Both gate
  // entry points call process.exit at once, which hides it; this caller lets
  // the loop empty instead. On Windows the kill is synchronous and the cap is
  // always armed before the exit, so only a POSIX run can fail here.
  it('leaves nothing behind that keeps the caller alive after a stall', async ({ signal }) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'stall-watch-'));
    dirs.push(dir);
    const pidFile = path.join(dir, 'grandchild.pid');
    const { child, done } = drive('silent', '0.02', pidFile, 'natural');
    /** @type {number | null} */
    let verdictAt = null;
    child.stdout.on('data', (chunk) => {
      if (verdictAt === null && String(chunk).includes('RESULT exit=')) verdictAt = Date.now();
    });
    leftovers.push(await readPid(pidFile, child, signal));
    const { code, out } = await done;
    const exitedAt = Date.now();
    expect(out).toContain('RESULT exit=124');
    expect(code).toBe(STALL_EXIT);
    expect(exitedAt - /** @type {number} */ (verdictAt)).toBeLessThan(5_000);
  }, 30_000);

  it('never kills a slow stage that keeps talking', async () => {
    // 10 s limit; the fixture prints every 250 ms for 12 s, so it outlives
    // the limit and only its talking can save it. The clock runs from the
    // spawn to the exit, so the limit must also cover the wait for the first
    // print: with a browser run, this suite and more beside it that took up
    // to 6.2 s, while the worst gap between prints was 1.3 s. A 2 s limit lost
    // 44 of 156 such runs: 41 had not printed by then, and 3 had printed in
    // time and stalled for a reason these runs did not show.
    const { done } = drive('talker', '0.1667');
    const { code, out } = await done;
    expect(out).not.toContain('STALLED');
    expect(out).toContain('done');
    expect(code).toBe(0);
  }, 45_000);

  // The driver takes the machine slot first, as every gate does, and the
  // slot's own SIGINT/SIGTERM handler exits at once: the forwarding must run
  // before it (the stage receives the SIGINT that was sent, not the exit
  // hook's SIGTERM), and a stage that traps the signal must still end, by
  // the SIGKILL after the grace.
  it.skipIf(process.platform === 'win32')(
    'interrupts a silent browser stage first, so it writes its report, and exits 124 (POSIX)',
    async ({ signal }) => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'stall-watch-'));
      dirs.push(dir);
      const pidFile = path.join(dir, 'grandchild.pid');
      const { child, done } = drive('browser', '0.02', pidFile);
      leftovers.push(await readPid(pidFile, child, signal));
      const { code, out } = await done;
      expect(code).toBe(STALL_EXIT);
      expect(readFileSync(`${pidFile}.report`, 'utf8')).toBe('written');
      expect(out).toContain('✖ STALLED: stage "stall-fixture browser"');
    },
    30_000
  );

  it.skipIf(process.platform === 'win32')(
    'still kills a browser stage that ignores the interrupt, after the wait (POSIX)',
    async ({ signal }) => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'stall-watch-'));
      dirs.push(dir);
      const pidFile = path.join(dir, 'grandchild.pid');
      const { child, done } = drive('stubborn-browser', '0.02', pidFile);
      const grandchild = await readPid(pidFile, child, signal);
      const stage = await readPid(`${pidFile}.stage`, child, signal);
      leftovers.push(grandchild, stage);
      const { code } = await done;
      expect(code).toBe(STALL_EXIT);
      expect(readFileSync(`${pidFile}.signals`, 'utf8').trim().split('\n')).toEqual([
        'SIGINT',
        'SIGTERM',
      ]);
      expect(await gone(stage)).toBe(true);
    },
    30_000
  );

  it.skipIf(process.platform === 'win32')(
    'kills any other silent stage without an interrupt (POSIX)',
    async ({ signal }) => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'stall-watch-'));
      dirs.push(dir);
      const pidFile = path.join(dir, 'grandchild.pid');
      const { child, done } = drive('stubborn', '0.02', pidFile);
      leftovers.push(await readPid(pidFile, child, signal), await readPid(`${pidFile}.stage`, child, signal));
      expect((await done).code).toBe(STALL_EXIT);
      expect(readFileSync(`${pidFile}.signals`, 'utf8').trim()).toBe('SIGTERM');
    },
    30_000
  );

  it.skipIf(process.platform === 'win32')(
    'forwards a SIGINT to the gate to the detached stage group, then SIGKILLs a stage that ignores it (POSIX)',
    async ({ signal }) => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'stall-watch-'));
      dirs.push(dir);
      const pidFile = path.join(dir, 'grandchild.pid');
      // A limit far beyond the test: only the signal can end the stage.
      const { child, done } = drive('stubborn', '30', pidFile);
      const grandchild = await readPid(pidFile, child, signal);
      const stage = await readPid(`${pidFile}.stage`, child, signal);
      leftovers.push(grandchild, stage);
      child.kill('SIGINT');
      const { code } = await done;
      expect(code).toBe(130);
      expect(readFileSync(`${pidFile}.signals`, 'utf8').split('\n')[0]).toBe('SIGINT');
      expect(await gone(stage)).toBe(true);
      expect(await gone(grandchild)).toBe(true);
    },
    30_000
  );
});

// Why: every gate takes the machine slot before it runs a stage, and the
// slot's SIGINT/SIGTERM handler exits at once. A forwarding handler added
// after it never runs, on any platform; this checks the ORDER where the
// POSIX test above cannot run (Windows), in a child process so the test
// worker's own listeners are untouched.
describe('signal forwarding order', { timeout: 30_000 }, () => {
  it("runs before the machine slot's exiting handler", () => {
    const slotUrl = pathToFileURL(fileURLToPath(new URL('./machine-slot.mjs', import.meta.url))).href;
    const stageUrl = pathToFileURL(fileURLToPath(new URL('./run-stage.mjs', import.meta.url))).href;
    const script = [
      `const { holdMachineSlotForProcess } = await import(${JSON.stringify(slotUrl)});`,
      `const { forwardSignalsToStages } = await import(${JSON.stringify(stageUrl)});`,
      `await holdMachineSlotForProcess('order probe');`,
      'forwardSignalsToStages();',
      "for (const signal of ['SIGINT', 'SIGTERM']) {",
      '  const first = String(process.listeners(signal)[0]);',
      "  console.log(signal + '=' + (first.includes('signalLiveStages') ? 'forward' : 'other'));",
      '}',
    ].join('\n');
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: { ...process.env, GATE_SLOT_DIR: 'off' },
    });
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('SIGINT=forward');
    expect(result.stdout).toContain('SIGTERM=forward');
  });
});
