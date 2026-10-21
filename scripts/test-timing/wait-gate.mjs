#!/usr/bin/env node
// The one background wait on a detached gate run (see wait-gate.mjs.md).
//
//   node scripts/test-timing/wait-gate.mjs <log>
//   node scripts/test-timing/wait-gate.mjs <log> --long-run "<what>" --quiet-min <minutes>
//
// Returns when the log carries a `GATE-RC=<n>` line (exit n), or when the
// log has not changed for the quiet window (exit QUIET_EXIT), whichever comes
// first. The quiet window is the stage watchdog's limit plus a margin, so a
// stage that hangs is killed by the watchdog first and the log moves again;
// a log that stays quiet past it means a hang the watchdog cannot see (the
// framework build, `pnpm install`, a run with the watch off). On "quiet" it
// names the machine slot's holder and what to do, instead of waiting on.
import { readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { describeHolder, readSlot, resolveSlotDir } from './machine-slot.mjs';
import { DEFAULT_STALL_MIN, STALL_ENV } from './stall-watch.mjs';

/** Exit code when the log went quiet without a GATE-RC line. */
export const QUIET_EXIT = 3;

/** Minutes added to the stage watchdog's limit to make the quiet window. */
export const QUIET_MARGIN_MIN = 5;

/** How often the log is looked at; tests shorten it. */
export const WAIT_POLL_ENV = 'WAIT_GATE_POLL_MS';
const DEFAULT_POLL_MS = 30_000;

const USAGE =
  'usage: wait-gate.mjs <log> [--long-run "<what>" --quiet-min <minutes>]';

/**
 * @typedef {{ log: string, longRun: string | null, quietMin: number | null }} WaitArgs
 */

/**
 * `--quiet-min` is the carve-out for a run that is known to be silent for
 * longer than a gate stage (a filtered sweep under CI=1 prints nothing until
 * it ends), and it is only accepted with the `--long-run` name that says
 * which run that is: an unnamed longer window is how a wedged gate gets
 * waited on for hours again.
 *
 * @param {readonly string[]} argv
 * @returns {WaitArgs | { error: string }}
 */
export function parseWaitArgs(argv) {
  /** @type {string | null} */
  let log = null;
  /** @type {string | null} */
  let longRun = null;
  /** @type {number | null} */
  let quietMin = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--long-run') {
      longRun = argv[++i] ?? '';
      if (longRun.trim() === '') return { error: `--long-run needs a name. ${USAGE}` };
    } else if (arg === '--quiet-min') {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value <= 0) {
        return { error: `--quiet-min needs a positive number of minutes. ${USAGE}` };
      }
      quietMin = value;
    } else if (log === null && !arg.startsWith('--')) {
      log = arg;
    } else {
      return { error: `unexpected argument "${arg}". ${USAGE}` };
    }
  }
  if (log === null) return { error: USAGE };
  if ((quietMin === null) !== (longRun === null)) {
    return {
      error: `--long-run and --quiet-min go together: a longer quiet window must say which run it is for. ${USAGE}`,
    };
  }
  return { log, longRun, quietMin };
}

/**
 * The quiet window in ms: the named override, else the stage watchdog's
 * limit (`GATE_STALL_MIN`, default 20; also 20 when the watch is off or the
 * value is malformed) plus QUIET_MARGIN_MIN.
 *
 * @param {Record<string, string | undefined>} env
 * @param {number | null} quietMin
 * @returns {number}
 */
export function quietWindowMs(env, quietMin) {
  if (quietMin !== null) return Math.round(quietMin * 60_000);
  const value = Number(env[STALL_ENV]);
  const stallMin = Number.isFinite(value) && value > 0 ? value : DEFAULT_STALL_MIN;
  return Math.round((stallMin + QUIET_MARGIN_MIN) * 60_000);
}

/**
 * @param {string} text
 * @returns {number | null} the exit code on the last `GATE-RC=<n>` line
 */
export function gateRc(text) {
  const matches = [...text.matchAll(/^GATE-RC=(\d+)\s*$/gm)];
  const last = matches.at(-1);
  return last ? Number(last[1]) : null;
}

/**
 * @param {{ rc: number | null, lastChangeMs: number, nowMs: number, quietMs: number }} input
 * @returns {{ state: 'done', rc: number } | { state: 'quiet', silentMs: number } | { state: 'wait' }}
 */
export function decideWait({ rc, lastChangeMs, nowMs, quietMs }) {
  if (rc !== null) return { state: 'done', rc };
  const silentMs = nowMs - lastChangeMs;
  return silentMs >= quietMs ? { state: 'quiet', silentMs } : { state: 'wait' };
}

/**
 * What to tell the waiter when the log went quiet.
 *
 * @param {{
 *   log: string,
 *   silentMs: number,
 *   quietMs: number,
 *   slot: { dir: string | null, present: boolean, existing: import('./machine-slot.mjs').SlotRecord | null },
 *   nowMs: number,
 *   platform: string,
 * }} input
 * @returns {string}
 */
export function quietReport({ log, silentMs, quietMs, slot, nowMs, platform }) {
  const min = (/** @type {number} */ ms) => (ms / 60_000).toFixed(1);
  /** @type {string[]} */
  const lines = [
    `✖ QUIET: ${log} has not changed for ${min(silentMs)} min (window ${min(quietMs)} min) and has no GATE-RC line.`,
    '  The run is most likely wedged where the stage watchdog cannot see it (outside a stage, or',
    '  with the watch off): a stage that hangs is killed by the watchdog before this window ends.',
  ];
  if (slot.dir === null) {
    lines.push('  Machine slot: off (GATE_SLOT_DIR=off), so no holder to name.');
  } else if (!slot.present) {
    lines.push(`  Machine slot: free (${slot.dir}) - the quiet run does not hold it.`);
  } else if (slot.existing === null) {
    lines.push(`  Machine slot: taken, but ${slot.dir} has no readable owner record.`);
  } else {
    const pid = slot.existing.pid;
    const kill =
      platform === 'win32'
        ? `taskkill /PID ${pid} /T /F`
        : `kill -TERM ${pid} and each descendant; pstree -p ${pid} lists them`;
    lines.push(
      `  Machine slot: ${describeHolder(slot.existing, nowMs)}.`,
      `  Action: if that is your run, end its whole process tree (${kill}); if it is another`,
      "  session's, report it and leave it alone. Do NOT relaunch a gate meanwhile: it would only",
      '  queue behind the run that holds the slot.'
    );
  }
  return lines.join('\n');
}

/**
 * @param {string} log
 * @returns {{ text: string, signature: string }} the log's text and a
 *   change signature (size and mtime); an absent log reads as empty
 */
function readLog(log) {
  const stats = statSync(log, { throwIfNoEntry: false });
  if (!stats) return { text: '', signature: 'absent' };
  let text = '';
  try {
    text = readFileSync(log, 'utf8');
  } catch {
    // A log being rotated or locked for a moment reads as unchanged text.
  }
  return { text, signature: `${stats.size}:${stats.mtimeMs}` };
}

/**
 * @param {readonly string[]} argv
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<number>} the exit code
 */
export async function runWait(argv, env) {
  const args = parseWaitArgs(argv);
  if ('error' in args) {
    console.error(`wait-gate: ${args.error}`);
    return 2;
  }
  const quietMs = quietWindowMs(env, args.quietMin);
  const pollValue = Number(env[WAIT_POLL_ENV]);
  const pollMs = Number.isFinite(pollValue) && pollValue > 0 ? pollValue : DEFAULT_POLL_MS;
  console.log(
    `wait-gate: waiting on ${args.log} for a GATE-RC line, or ${(quietMs / 60_000).toFixed(1)} min without a change` +
      (args.longRun ? ` (long run: ${args.longRun})` : '')
  );
  let { signature } = readLog(args.log);
  let lastChangeMs = Date.now();
  for (;;) {
    const current = readLog(args.log);
    const nowMs = Date.now();
    if (current.signature !== signature) {
      signature = current.signature;
      lastChangeMs = nowMs;
    }
    const decision = decideWait({ rc: gateRc(current.text), lastChangeMs, nowMs, quietMs });
    if (decision.state === 'done') {
      console.log(`wait-gate: GATE-RC=${decision.rc} (${args.log})`);
      return decision.rc;
    }
    if (decision.state === 'quiet') {
      const dir = resolveSlotDir(env);
      const slot = dir === null ? { present: false, existing: null } : readSlot(dir);
      console.log(
        quietReport({
          log: args.log,
          silentMs: decision.silentMs,
          quietMs,
          slot: { dir, present: slot.present, existing: slot.existing },
          nowMs,
          platform: process.platform,
        })
      );
      return QUIET_EXIT;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

// Run as a CLI only when executed directly, never when imported.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(await runWait(process.argv.slice(2), process.env));
}
