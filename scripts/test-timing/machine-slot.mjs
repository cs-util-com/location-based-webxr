// One machine-wide slot for every session's gates, sweeps and browser suites
// (gate-speed plan 2026-10-04, TS-3 / G1).
//
// The per-tree lock in gate-lock.mjs keeps two gates out of ONE working tree.
// It cannot see a second worktree or a second session, and on the night of
// 2026-10-03/04 that was the whole problem: two sessions' gates, sweeps and 3D
// browser suites overlapped on one 8-CPU machine, a file that takes 32 s quiet
// took 308 s, and stages that take seconds timed out in untouched files.
//
// THE SLOT IS A DIRECTORY, `C:\gps\.e2e-slots\gate`, beside the slot dirs the
// sessions' shell scripts already use. `mkdir` is atomic on every filesystem
// we run on, so creating it IS the acquisition; `owner.json` inside records
// who holds it (pid, start time, command, cwd) for the queue line.
//
// LIVENESS IS A HEARTBEAT, NOT A PID (milestone review R1). The holder touches
// `owner.json` every HEARTBEAT_MS from a worker thread, and a slot whose
// heartbeat is older than HEARTBEAT_STALE_MS is reclaimed whatever its pid
// says. Windows reuses pids quickly, so a dead-pid check could keep a killed
// gate's slot "alive" until the 3 h cap. The heartbeat runs in a WORKER because
// a holder may block its main thread for the whole run (`test-changed.mjs`
// spawns every gate with `spawnSync`); a main-thread timer would never fire.
// The worker dies with the process, so a killed holder stops beating at once.
//
// Unlike the per-tree lock this one QUEUES. Two sessions wanting the machine
// at once is the normal case, not a mistake, so the second one waits, saying
// so, until the first is done or the timeout passes. A queue timeout exits
// with QUEUE_TIMEOUT_EXIT (75), never with a test failure's code.
//
// Lock order: the machine slot is the OUTER lock and the per-tree lock the
// inner one. The per-tree lock refuses and never waits, so the two cannot
// deadlock: a run that holds the slot and then finds its tree busy exits at
// once and frees the slot.
//
// Off where the convention does not exist: if `C:\gps\.e2e-slots` is absent
// (CI runners, another machine) and `GATE_SLOT_DIR` is not set, every call is
// a no-op. `GATE_SLOT_DIR=off` switches it off explicitly.
//
// CLI: `node scripts/test-timing/machine-slot.mjs run -- <command...>` takes
// the slot with a proper record and heartbeat, runs the command through the
// shell, frees the slot and exits with the command's code. It is the way for
// shell jobs and sweeps to take the slot.

import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

import { MAX_LOCK_AGE_MS } from './gate-lock.mjs';

/** Env var carrying the holder's token down to the runs it spawns. */
export const SLOT_HELD_ENV = 'GATE_MACHINE_SLOT_TOKEN';

/** Env var overriding the slot directory (`off` disables the slot). */
export const SLOT_DIR_ENV = 'GATE_SLOT_DIR';

/**
 * Env var opting a FILTERED unit-test run into the slot: `GATE_SLOT=take`.
 * For long measurement sweeps run as `pnpm run test:unit <file>`.
 */
export const SLOT_OPT_IN_ENV = 'GATE_SLOT';

/** Env var overriding the queue timeout, in minutes. */
export const SLOT_TIMEOUT_ENV = 'GATE_SLOT_TIMEOUT_MIN';

/** The machine convention: the sessions' existing slot directory. */
export const SLOTS_PARENT = 'C:\\gps\\.e2e-slots';

/** File inside the slot directory naming the holder; its mtime is the heartbeat. */
export const OWNER_FILE = 'owner.json';

/**
 * How often the holder touches `owner.json`. See the sidecar's "Thresholds"
 * for the measured jitter under load and what would reverse it.
 */
export const HEARTBEAT_MS = 30_000;

/**
 * A slot whose heartbeat (the mtime of `owner.json`, or of the directory when
 * there is no record yet) is older than this is reclaimed, whatever its pid.
 * Six missed beats: a killed gate frees the machine within about 3 min.
 */
export const HEARTBEAT_STALE_MS = 3 * 60_000;

/**
 * How long a run queues before giving up. Two hours: the longest holds that
 * take the slot whole are a full cascade (~23 min quiet) and OsmDemo's e2e
 * (~17-22 min), so a waiter behind two or three of them still gets through.
 * Override per run with `GATE_SLOT_TIMEOUT_MIN`.
 */
export const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000;

/** How often a waiter looks again. Cheap: one stat and one small read. */
export const DEFAULT_POLL_MS = 5_000;

/** How often a waiter reprints its queue line. */
export const REMIND_EVERY_MS = 5 * 60_000;

/**
 * Exit code of a run that gave up in the queue: EX_TEMPFAIL, "try again
 * later", so a script or an agent can tell it from a red test (exit 1).
 */
export const QUEUE_TIMEOUT_EXIT = 75;

/**
 * @typedef {object} SlotRecord
 * @property {string} [token] unique id of the holding run (absent when a
 *   shell script wrote the record)
 * @property {number} pid pid of the holder, used only for the ancestor check
 * @property {number} startedAt epoch ms when the slot was taken
 * @property {string} [command] what the holder runs, for the queue line
 * @property {string} [cwd] where it runs
 */

/**
 * @typedef {object} SlotDecision
 * @property {'acquire' | 'reenter' | 'wait' | 'steal'} action
 * @property {string} reason
 */

/**
 * Pure decision: what should a run do about the slot it found?
 *
 * Stale means no heartbeat for HEARTBEAT_STALE_MS, whatever the pid, or a
 * record older than gate-lock's 3 h cap (MAX_LOCK_AGE_MS) even with a fresh
 * heartbeat: a defence against a holder that is alive but wedged.
 *
 * @param {object} input
 * @param {boolean} input.present whether the slot directory exists
 * @param {SlotRecord | null} input.existing the record inside, if readable
 * @param {number | null} input.heartbeatMs the last heartbeat: the mtime of
 *   `owner.json`, or of the directory when there is no record
 * @param {string | undefined} input.inheritedToken the token an ancestor run
 *   exported, if any
 * @param {number} input.now epoch ms
 * @returns {SlotDecision}
 */
export function decideMachineSlot({
  present,
  existing,
  heartbeatMs,
  inheritedToken,
  now,
}) {
  if (!present) {
    return { action: 'acquire', reason: 'the machine slot is free' };
  }
  if (
    typeof inheritedToken === 'string' &&
    inheritedToken !== '' &&
    existing?.token === inheritedToken
  ) {
    return { action: 'reenter', reason: `part of run ${inheritedToken}` };
  }
  const silentMs =
    heartbeatMs !== null && Number.isFinite(heartbeatMs)
      ? now - heartbeatMs
      : Number.NaN;
  if (silentMs > HEARTBEAT_STALE_MS) {
    return {
      action: 'steal',
      reason: `the machine slot has had no heartbeat for ${formatWait(silentMs)}${existing ? ` (holder pid ${existing.pid})` : ''} - reclaiming it`,
    };
  }
  if (
    existing !== null &&
    Number.isFinite(existing.startedAt) &&
    now - existing.startedAt > MAX_LOCK_AGE_MS
  ) {
    return {
      action: 'steal',
      reason: `the machine slot's holder (pid ${existing.pid}) is past the 3 h cap - reclaiming it`,
    };
  }
  if (existing === null) {
    return { action: 'wait', reason: 'the machine slot is being taken by another run' };
  }
  return { action: 'wait', reason: describeHolder(existing, now) };
}

/**
 * @param {SlotRecord} holder
 * @param {number} now
 * @returns {string} one line naming the holder
 */
export function describeHolder(holder, now) {
  const since = Number.isFinite(holder.startedAt)
    ? `since ${new Date(holder.startedAt).toLocaleTimeString('en-GB', { hour12: false })} (${Math.max(0, Math.round((now - holder.startedAt) / 60_000))} min)`
    : 'since an unknown time';
  const what = holder.command ? ` running "${holder.command}"` : '';
  const where = holder.cwd ? ` in ${holder.cwd}` : '';
  return `held by pid ${holder.pid} ${since}${what}${where}`;
}

/**
 * Does a single-stage run (`timed-stage.mjs`) take the machine slot?
 *
 * Every stage run does, except a FILTERED unit-test run (a vitest stage with
 * file arguments): a TDD step of 1-5 s must not queue behind a browser run
 * that holds the slot for minutes (the peer session's change, 2026-10-04).
 * A filtered BROWSER run still takes it, since it starts Chromium. A long
 * sweep run as a filtered unit run opts in with `GATE_SLOT=take`.
 *
 * @param {object} input
 * @param {{ counts: string | null } | undefined} input.stage the stage's
 *   config; unknown means take (the safe direction)
 * @param {readonly string[]} input.forwardedArgs the run's extra CLI args
 * @param {Record<string, string | undefined>} input.env
 * @returns {{ take: boolean, reason: string }}
 */
export function stageRunTakesSlot({ stage, forwardedArgs, env }) {
  // pnpm may forward a bare leading `--`; it filters nothing (stage-args.mjs).
  const args = forwardedArgs[0] === '--' ? forwardedArgs.slice(1) : forwardedArgs;
  const filteredUnit = args.length > 0 && stage?.counts === 'vitest';
  if (filteredUnit && env[SLOT_OPT_IN_ENV] !== 'take') {
    return {
      take: false,
      reason: `machine slot: not taken (filtered unit-test run); set ${SLOT_OPT_IN_ENV}=take for a long sweep`,
    };
  }
  return {
    take: true,
    reason: filteredUnit
      ? `${SLOT_OPT_IN_ENV}=take: this filtered unit-test run takes the machine slot`
      : 'a full stage run, or a browser run',
  };
}

/**
 * The slot directory for this machine, or null when the slot is off.
 *
 * @param {Record<string, string | undefined>} env
 * @param {(p: string) => boolean} [exists]
 * @returns {string | null}
 */
export function resolveSlotDir(env, exists = existsSync) {
  const override = env[SLOT_DIR_ENV];
  if (typeof override === 'string' && override !== '') {
    return override === 'off' ? null : override;
  }
  return exists(SLOTS_PARENT) ? path.join(SLOTS_PARENT, 'gate') : null;
}

/**
 * Reads the slot, tolerating every way it can be unusable.
 *
 * @param {string} dir
 * @returns {{ present: boolean, existing: SlotRecord | null, heartbeatMs: number | null }}
 */
export function readSlot(dir) {
  const stats = statSync(dir, { throwIfNoEntry: false });
  if (!stats) {
    return { present: false, existing: null, heartbeatMs: null };
  }
  const owner = path.join(dir, OWNER_FILE);
  const ownerStats = statSync(owner, { throwIfNoEntry: false });
  return {
    present: true,
    existing: readRecord(owner),
    heartbeatMs: ownerStats ? ownerStats.mtimeMs : stats.mtimeMs,
  };
}

/**
 * @param {string} file
 * @returns {SlotRecord | null}
 */
function readRecord(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      !Number.isInteger(parsed.pid)
    ) {
      return null;
    }
    return /** @type {SlotRecord} */ (parsed);
  } catch {
    return null;
  }
}

/**
 * Creates the slot. `mkdir` is the arbiter: exactly one caller gets `true`.
 *
 * @param {string} dir
 * @param {SlotRecord} record
 * @returns {boolean} whether this call took the slot
 */
export function tryCreateSlot(dir, record) {
  mkdirSync(path.dirname(dir), { recursive: true });
  try {
    mkdirSync(dir);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'EEXIST') {
      return false;
    }
    throw error;
  }
  writeFileSync(path.join(dir, OWNER_FILE), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return true;
}

/**
 * @param {SlotRecord | null} a
 * @param {SlotRecord | null} b
 * @returns {boolean}
 */
function sameRecord(a, b) {
  if (a === null || b === null) {
    return a === b;
  }
  return a.token === b.token && a.pid === b.pid && a.startedAt === b.startedAt;
}

/**
 * Steals a slot judged stale, by RENAMING it away first.
 *
 * A plain `rm` then `mkdir` lets two waiters that both saw the same stale lock
 * both win: A removes it and takes the slot, then B removes A's FRESH lock and
 * takes it too. Renaming moves the directory atomically, so B then holds the
 * moved directory and can look inside it: if it is not the record B judged
 * stale, B moved a live lock, and puts it straight back.
 *
 * @param {string} dir
 * @param {SlotRecord | null} judgedStale the record the steal decision saw
 * @returns {'stolen' | 'lost' | 'restored' | 'displaced'}
 *   `lost`: someone else moved it first; `restored`: a live lock was moved and
 *   put back; `displaced`: a live lock was moved and could NOT be put back
 *   (a third run took the empty path in between); the caller warns.
 */
export function stealSlot(dir, judgedStale) {
  const moved = `${dir}.stale-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    renameSync(dir, moved);
  } catch {
    // ENOENT: another waiter moved it first. EPERM/EBUSY (Windows, a scanner
    // holding a handle): try again on the next poll.
    return 'lost';
  }
  if (sameRecord(readRecord(path.join(moved, OWNER_FILE)), judgedStale)) {
    rmSync(moved, { recursive: true, force: true });
    return 'stolen';
  }
  try {
    renameSync(moved, dir);
    return 'restored';
  } catch {
    return 'displaced';
  }
}

/** The heartbeat worker's code: touch the file every `ms`, swallow errors. */
const HEARTBEAT_WORKER = `
const { workerData } = require('node:worker_threads');
const { utimesSync } = require('node:fs');
setInterval(() => {
  try {
    const t = new Date();
    utimesSync(workerData.file, t, t);
  } catch {}
}, workerData.ms);
`;

/**
 * Starts the heartbeat: a worker thread that touches `file` every `ms`. A
 * worker, not a main-thread timer, so a holder that blocks its main thread
 * (`spawnSync`) keeps beating; `unref` so it never keeps a process alive.
 *
 * @param {string} file
 * @param {number} [ms]
 * @returns {() => void} stops the heartbeat
 */
export function startHeartbeat(file, ms = HEARTBEAT_MS) {
  const worker = new Worker(HEARTBEAT_WORKER, {
    eval: true,
    workerData: { file, ms },
  });
  worker.unref();
  return () => {
    void worker.terminate();
  };
}

/**
 * @typedef {object} HeldSlot
 * @property {'acquired' | 'reentered' | 'timed-out' | 'held-by-ancestor' | 'off'} outcome
 * @property {() => void} release frees the slot if, and only if, this run
 *   still holds it; a no-op for every other outcome
 */

/**
 * Takes the machine slot, queueing behind a live holder.
 *
 * @param {object} options
 * @param {string | null} options.dir the slot directory, or null when off
 * @param {Record<string, string | undefined>} options.env read for the
 *   inherited token and timeout; the token is WRITTEN here on acquisition, so
 *   pass `process.env` for children to inherit it
 * @param {string} options.command what this run is, for other runs' queue line
 * @param {(line: string) => void} options.log
 * @param {() => number} [options.now]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.pollMs]
 * @param {number} [options.pid]
 * @param {string} [options.cwd]
 * @param {() => readonly number[]} [options.listAncestors] pids of this
 *   process's ancestors; asked once, only when the run would queue
 * @param {(file: string) => () => void} [options.heartbeat] starts the
 *   holder's heartbeat; returns its stop function
 * @param {typeof stealSlot} [options.steal] injected for tests
 * @returns {Promise<HeldSlot>}
 */
export async function acquireMachineSlot({
  dir,
  env,
  command,
  log,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = timeoutFromEnv(env),
  pollMs = DEFAULT_POLL_MS,
  pid = process.pid,
  cwd = process.cwd(),
  listAncestors = ancestorPids,
  heartbeat = startHeartbeat,
  steal = stealSlot,
}) {
  const noop = () => {};
  if (dir === null) {
    return { outcome: 'off', release: noop };
  }
  const start = now();
  let lastReminder = Number.NEGATIVE_INFINITY;
  /** @type {readonly number[] | null} */
  let ancestors = null;
  /** @type {SlotDecision | null} */
  let lastDecision = null;

  for (;;) {
    const seen = readSlot(dir);
    const decision = decideMachineSlot({
      ...seen,
      inheritedToken: env[SLOT_HELD_ENV],
      now: now(),
    });
    lastDecision = decision;

    if (decision.action === 'reenter') {
      return { outcome: 'reentered', release: noop };
    }
    if (decision.action === 'acquire') {
      const startedAt = now();
      const token = `${pid}-${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      if (tryCreateSlot(dir, { token, pid, startedAt, command, cwd })) {
        if (start !== startedAt && Number.isFinite(lastReminder)) {
          log(`machine slot: taken after ${formatWait(startedAt - start)} in the queue`);
        }
        env[SLOT_HELD_ENV] = token;
        const stop = heartbeat(path.join(dir, OWNER_FILE));
        return {
          outcome: 'acquired',
          release: () => {
            stop();
            releaseSlot(dir, token);
          },
        };
      }
      continue; // lost the mkdir race; the next read sees the winner
    }
    if (decision.action === 'steal') {
      const result = steal(dir, seen.existing);
      if (result === 'stolen') {
        log(`machine slot: ${decision.reason}`);
        continue; // the slot is free now: take it on the next pass
      }
      if (result === 'displaced') {
        log(`machine slot: WARNING - moved a live holder's slot aside and could not put it back; two runs may now share the machine`);
      }
      // lost / restored / displaced: someone else is acting on the slot.
      // Fall through to the timeout check and the sleep, never spin.
    } else if (seen.existing !== null) {
      // wait - unless the holder is one of our own ancestors: a shell that
      // took the slot around this gate without exporting its token. Only
      // reached with a FRESH heartbeat (a stale slot is stolen above), so a
      // reused pid of a dead holder cannot produce this error.
      ancestors ??= safeAncestors(listAncestors);
      if (ancestors.includes(seen.existing.pid)) {
        log(
          `machine slot: ERROR - the slot is held by pid ${seen.existing.pid}, an ANCESTOR of this run, ` +
            `so waiting would wait for itself. A shell must not create ${dir} around a node gate; ` +
            `take the slot with \`node scripts/test-timing/machine-slot.mjs run -- <command>\` instead.`
        );
        return { outcome: 'held-by-ancestor', release: noop };
      }
    }

    const t = now();
    const waited = t - start;
    if (waited >= timeoutMs) {
      log(
        `machine slot: QUEUE TIMEOUT (exit ${QUEUE_TIMEOUT_EXIT}) - this is NOT a test failure. ` +
          `Gave up after ${Math.round(timeoutMs / 60_000)} min in the queue; ${lastDecision.reason}. ` +
          `Re-run later, or raise ${SLOT_TIMEOUT_ENV}.`
      );
      return { outcome: 'timed-out', release: noop };
    }
    if (decision.action === 'wait' && t - lastReminder >= REMIND_EVERY_MS) {
      log(
        lastReminder === Number.NEGATIVE_INFINITY
          ? `machine slot: QUEUED (not hung) - "${command}" waits for ${dir}, ${decision.reason}; waiting up to ${Math.round(timeoutMs / 60_000)} min`
          : `machine slot: still queued after ${formatWait(waited)} - "${command}" waits; ${decision.reason}`
      );
      lastReminder = t;
    }
    await sleep(pollMs);
  }
}

/**
 * @param {number} ms
 * @returns {string} seconds below two minutes, minutes above
 */
function formatWait(ms) {
  return ms < 120_000
    ? `${Math.round(ms / 1000)} s`
    : `${Math.round(ms / 60_000)} min`;
}

/**
 * @param {() => readonly number[]} list
 * @returns {readonly number[]}
 */
function safeAncestors(list) {
  try {
    return list();
  } catch {
    return [];
  }
}

/**
 * Parses a `<pid> <parent pid>` per line process listing (the PowerShell
 * command below, or `ps -o pid=,ppid=`) into a child-to-parent map. Lines
 * that are not two integers are skipped.
 *
 * @param {string} text
 * @returns {Map<number, number>}
 */
export function parseProcessTable(text) {
  /** @type {Map<number, number>} */
  const parentOf = new Map();
  for (const line of text.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 2 || !fields.every((f) => /^\d+$/.test(f))) {
      continue;
    }
    parentOf.set(Number(fields[0]), Number(fields[1]));
  }
  return parentOf;
}

/**
 * The ancestors of `pid` in a child-to-parent map, nearest first, stopping at
 * a missing parent, pid 0 or a cycle.
 *
 * @param {Map<number, number>} parentOf
 * @param {number} pid
 * @returns {number[]}
 */
export function ancestorChain(parentOf, pid) {
  /** @type {number[]} */
  const chain = [];
  let current = pid;
  for (let i = 0; i < 64; i++) {
    const parent = parentOf.get(current);
    if (parent === undefined || parent <= 0 || parent === pid || chain.includes(parent)) {
      break;
    }
    chain.push(parent);
    current = parent;
  }
  return chain;
}

/**
 * The pids of this process's ancestors, nearest first. One process listing
 * (PowerShell on Windows, `ps` elsewhere), asked only when a run is about to
 * queue. On any failure, just the direct parent.
 *
 * @returns {number[]}
 */
export function ancestorPids() {
  let text;
  try {
    text =
      process.platform === 'win32'
        ? execFileSync(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }',
            ],
            { encoding: 'utf8', windowsHide: true, timeout: 30_000 }
          )
        : execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' });
  } catch {
    return [process.ppid];
  }
  const chain = ancestorChain(parseProcessTable(text), process.pid);
  return chain.length > 0 ? chain : [process.ppid];
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {number}
 */
function timeoutFromEnv(env) {
  const minutes = Number(env[SLOT_TIMEOUT_ENV]);
  return Number.isFinite(minutes) && minutes > 0
    ? minutes * 60_000
    : DEFAULT_TIMEOUT_MS;
}

/**
 * Frees the slot only if this run still holds it: a slot reclaimed from under
 * a run (no heartbeat, or past the 3 h cap) now belongs to someone else.
 *
 * @param {string} dir
 * @param {string} token
 * @returns {void}
 */
function releaseSlot(dir, token) {
  try {
    const held = readRecord(path.join(dir, OWNER_FILE));
    if (held?.token !== token) {
      return;
    }
    const gone = `${dir}.released-${process.pid}-${Date.now().toString(36)}`;
    renameSync(dir, gone);
    rmSync(gone, { recursive: true, force: true });
  } catch {
    // Never fail a gate over cleanup: the staleness rule covers a slot that
    // outlives its holder.
  }
}

/**
 * @typedef {object} ProcessLike
 * @property {Record<string, string | undefined>} env
 * @property {(event: string, listener: () => void) => unknown} on
 * @property {(code: number) => never | void} exit
 */

/**
 * The CLI shells' one-liner: take the slot for this process and free it on
 * every way out.
 *
 * - Queue timeout: exit QUEUE_TIMEOUT_EXIT (75), not a test failure's code.
 * - Ancestor holder: exit 1 (a wiring error, not a transient one).
 * - SIGINT / SIGTERM: exit 130 and nothing else. The release happens in the
 *   'exit' listener, AFTER the callers' own exit listeners that were
 *   prepended (run-gate.mjs frees its per-tree lock that way), so the inner
 *   lock is always freed before the outer slot (review R6).
 *
 * @param {string} command
 * @param {object} [deps] injected for tests
 * @param {ProcessLike} [deps.proc]
 * @param {(options: Parameters<typeof acquireMachineSlot>[0]) => Promise<HeldSlot>} [deps.acquire]
 * @returns {Promise<HeldSlot>}
 */
export async function holdMachineSlotForProcess(
  command,
  { proc = process, acquire = acquireMachineSlot } = {}
) {
  const slot = await acquire({
    dir: resolveSlotDir(proc.env),
    env: proc.env,
    command,
    log: (line) => console.error(line),
  });
  if (slot.outcome === 'timed-out') {
    proc.exit(QUEUE_TIMEOUT_EXIT);
    return slot;
  }
  if (slot.outcome === 'held-by-ancestor') {
    proc.exit(1);
    return slot;
  }
  proc.on('exit', slot.release);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    proc.on(signal, () => {
      proc.exit(130);
    });
  }
  return slot;
}

/**
 * Quotes one argument for the shell `spawn(..., { shell: true })` uses:
 * double quotes for cmd.exe (inside them `& | < > ( )` are literal; an inner
 * `"` becomes `\"`, which Node's own argv parser reads back), single quotes
 * for a POSIX shell. Plain words pass unquoted.
 *
 * @param {string} arg
 * @param {string} [platform]
 * @returns {string}
 */
export function quoteForShell(arg, platform = process.platform) {
  if (arg !== '' && !/[\s"'&|<>^()%!$`;*?\\{}[\]~#]/.test(arg)) {
    return arg;
  }
  return platform === 'win32'
    ? `"${arg.replaceAll('"', '\\"')}"`
    : `'${arg.replaceAll("'", "'\\''")}'`;
}

/**
 * The shell line for `run -- <command...>`: ONE argument is a raw shell line
 * (so `&&` and pipes work); several are quoted one by one so each reaches the
 * program exactly as given (a real run joined `node -e "()=>{}"` unquoted and
 * the shell read `>` as a redirect).
 *
 * @param {readonly string[]} commandArgs
 * @param {string} [platform]
 * @returns {string}
 */
export function shellLine(commandArgs, platform = process.platform) {
  return commandArgs.length === 1
    ? commandArgs[0]
    : commandArgs.map((arg) => quoteForShell(arg, platform)).join(' ');
}

/**
 * `run -- <command...>`: take the slot, run the command through the shell
 * with the slot's token in its environment (so gates inside it re-enter),
 * free the slot, and return the command's exit code.
 *
 * @param {readonly string[]} argv the CLI arguments after the script path
 * @returns {Promise<number>} the exit code to leave with
 */
export async function runCli(argv) {
  const [verb, ...rest] = argv;
  const commandArgs = rest[0] === '--' ? rest.slice(1) : rest;
  if (verb !== 'run' || commandArgs.length === 0) {
    console.error('usage: node scripts/test-timing/machine-slot.mjs run -- <command...>');
    return 2;
  }
  const command = shellLine(commandArgs);
  await holdMachineSlotForProcess(command);
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, stdio: 'inherit', env: process.env });
    child.on('error', () => resolve(1));
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 130 : 1)));
  });
}

// Run as a CLI only when executed directly, never when imported.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(await runCli(process.argv.slice(2)));
}
