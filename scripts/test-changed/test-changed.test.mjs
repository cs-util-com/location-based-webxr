// Why this test matters: the waiter on a detached gate (wait-gate.mjs) sizes
// its quiet window from the watchdog limit the GATE states in its log, since
// the waiter's own shell may carry another GATE_STALL_MIN. If the commit
// gate stopped writing that line, every wait would silently fall back to its
// own environment again. Run as the CLI with --dry-run, which takes no slot
// and runs nothing.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseWatchLine } from '../test-timing/stall-watch.mjs';

const SCRIPT = fileURLToPath(new URL('./test-changed.mjs', import.meta.url));

/** @param {Record<string, string>} env */
function dryRun(env) {
  const result = spawnSync(process.execPath, [SCRIPT, '--all', '--dry-run'], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

describe('test-changed states its watchdog limit in its log', { timeout: 30_000 }, () => {
  it('writes the limit its stages run with', () => {
    const { status, out } = dryRun({ GATE_STALL_MIN: '7' });
    expect(status).toBe(0);
    expect(parseWatchLine(out)).toEqual({ minutes: 7 });
  });

  it('writes that the watch is off', () => {
    expect(parseWatchLine(dryRun({ GATE_STALL_MIN: 'off' }).out)).toEqual({ off: true });
  });
});
