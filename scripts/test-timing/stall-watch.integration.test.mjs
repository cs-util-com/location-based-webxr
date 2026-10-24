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

/** Resolves once the file holds a pid. */
async function readPid(/** @type {string} */ file, tries = 200) {
  for (let i = 0; i < tries; i++) {
    try {
      const pid = Number(readFileSync(file, 'utf8'));
      if (Number.isInteger(pid) && pid > 0) return pid;
    } catch {
      // not written yet
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`no pid in ${file}`);
}

/** @type {string[]} */
const dirs = [];
/** @type {number[]} */
const leftovers = [];
afterEach(() => {
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
      GATE_STALL_MIN: limitMin,
      GATE_STALL_POLL_MS: '100',
      GATE_SLOT_DIR: 'off',
    },
  });
  let out = '';
  child.stdout.on('data', (chunk) => (out += chunk));
  child.stderr.on('data', (chunk) => (out += chunk));
  const done = new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal, out }));
  });
  return { child, done: /** @type {Promise<{ code: number | null, signal: string | null, out: string }>} */ (done) };
}

describe('the stage watchdog, end to end', () => {
  it('kills a silent stage and its forked grandchild, and exits 124', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'stall-watch-'));
    dirs.push(dir);
    const pidFile = path.join(dir, 'grandchild.pid');
    // 0.02 min = 1.2 s of silence.
    const { done } = drive('silent', '0.02', pidFile);
    const grandchild = await readPid(pidFile);
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
  it('leaves nothing behind that keeps the caller alive after a stall', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'stall-watch-'));
    dirs.push(dir);
    const pidFile = path.join(dir, 'grandchild.pid');
    const { child, done } = drive('silent', '0.02', pidFile, 'natural');
    /** @type {number | null} */
    let verdictAt = null;
    child.stdout.on('data', (chunk) => {
      if (verdictAt === null && String(chunk).includes('RESULT exit=')) verdictAt = Date.now();
    });
    leftovers.push(await readPid(pidFile));
    const { code, out } = await done;
    const exitedAt = Date.now();
    expect(out).toContain('RESULT exit=124');
    expect(code).toBe(STALL_EXIT);
    expect(exitedAt - /** @type {number} */ (verdictAt)).toBeLessThan(5_000);
  }, 30_000);

  it('never kills a slow stage that keeps talking', async () => {
    // 2 s limit; the fixture prints every 250 ms for 5 s.
    const { done } = drive('talker', '0.0333');
    const { code, out } = await done;
    expect(out).not.toContain('STALLED');
    expect(out).toContain('done');
    expect(code).toBe(0);
  }, 30_000);

  // The driver takes the machine slot first, as every gate does, and the
  // slot's own SIGINT/SIGTERM handler exits at once: the forwarding must run
  // before it (the stage receives the SIGINT that was sent, not the exit
  // hook's SIGTERM), and a stage that traps the signal must still end, by
  // the SIGKILL after the grace.
  it.skipIf(process.platform === 'win32')(
    'forwards a SIGINT to the gate to the detached stage group, then SIGKILLs a stage that ignores it (POSIX)',
    async () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'stall-watch-'));
      dirs.push(dir);
      const pidFile = path.join(dir, 'grandchild.pid');
      // A limit far beyond the test: only the signal can end the stage.
      const { child, done } = drive('stubborn', '30', pidFile);
      const grandchild = await readPid(pidFile);
      const stage = await readPid(`${pidFile}.stage`);
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
