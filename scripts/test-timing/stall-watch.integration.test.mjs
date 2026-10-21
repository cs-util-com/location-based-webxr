// Why this test matters: the watchdog's whole value is in its spawning half,
// which no pure test reaches. A silent stage must be killed with its whole
// process tree, including a forked grandchild (a vitest worker busy in a
// shrink is exactly such a grandchild), and must exit 124 with the banner; a
// slow stage that keeps talking must never be killed. On POSIX a SIGTERM to
// the gate must reach the stage's own process group too, since the stage
// runs detached there. Real processes, a tiny limit and a short poll; it runs
// on Windows locally and on Linux in CI.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
 */
function drive(stage, limitMin, pidFile = '') {
  const child = spawn(process.execPath, [DRIVER, stage, pidFile], {
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

  it('never kills a slow stage that keeps talking', async () => {
    // 2 s limit; the fixture prints every 250 ms for 5 s.
    const { done } = drive('talker', '0.0333');
    const { code, out } = await done;
    expect(out).not.toContain('STALLED');
    expect(out).toContain('done');
    expect(code).toBe(0);
  }, 30_000);

  it.skipIf(process.platform === 'win32')(
    'forwards a SIGTERM to the gate to the detached stage group (POSIX)',
    async () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'stall-watch-'));
      dirs.push(dir);
      const pidFile = path.join(dir, 'grandchild.pid');
      // A limit far beyond the test: only the signal can end the stage.
      const { child, done } = drive('silent', '30', pidFile);
      const grandchild = await readPid(pidFile);
      leftovers.push(grandchild);
      child.kill('SIGTERM');
      await done;
      expect(await gone(grandchild)).toBe(true);
    },
    30_000
  );
});
