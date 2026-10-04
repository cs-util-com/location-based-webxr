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
// who holds it (a Windows pid every tool can see, the start time, the command
// and the cwd) for the queue line and the staleness rule.
//
// Unlike the per-tree lock this one QUEUES. Two sessions wanting the machine
// at once is the normal case, not a mistake, so the second one waits, saying
// so, until the first is done or the timeout passes.
//
// Lock order: the machine slot is the OUTER lock and the per-tree lock the
// inner one. The per-tree lock refuses and never waits, so the two cannot
// deadlock: a run that holds the slot and then finds its tree busy exits at
// once and frees the slot.
//
// Off where the convention does not exist: if `C:\gps\.e2e-slots` is absent
// (CI runners, another machine) and `GATE_SLOT_DIR` is not set, every call is
// a no-op. `GATE_SLOT_DIR=off` switches it off explicitly.

import { execFileSync } from 'node:child_process';
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

import { decideGateLock, pidAlive } from './gate-lock.mjs';

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

/** File inside the slot directory naming the holder. */
export const OWNER_FILE = 'owner.json';

/**
 * A dead holder's lock is reclaimed only once it is older than this. Below it
 * the record may still be mid-write (the holder made the directory a moment
 * ago), or the holder may be a shell script that recorded a pid other tools
 * cannot see yet. Agreed with the peer session (TS-3).
 */
export const MIN_STALE_AGE_MS = 60_000;

/**
 * How long a run queues before giving up. Two hours: the longest holds that
 * take the slot whole are a full cascade (~23 min quiet) and OsmDemo's e2e
 * (~17-22 min), so a waiter behind two or three of them still gets through,
 * while a wedged holder does not keep a queue alive past the 3 h staleness
 * cap. Override per run with `GATE_SLOT_TIMEOUT_MIN`.
 */
export const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000;

/** How often a waiter looks again. Cheap: one stat and one small read. */
export const DEFAULT_POLL_MS = 5_000;

/** How often a waiter reprints its queue line. */
export const REMIND_EVERY_MS = 5 * 60_000;

/**
 * @typedef {object} SlotRecord
 * @property {string} [token] unique id of the holding run (absent when a
 *   shell script wrote the record)
 * @property {number} pid Windows pid of the holder
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
 * The staleness rule is `decideGateLock`'s (dead pid, or past its 3 h cap
 * against pid reuse), not a second implementation; this adds only the
 * one-minute grace and turns its `refuse` into `wait`.
 *
 * @param {object} input
 * @param {boolean} input.present whether the slot directory exists
 * @param {SlotRecord | null} input.existing the record inside, if readable
 * @param {number | null} input.dirMtimeMs the directory's mtime, the age of a
 *   slot whose record is missing or unreadable
 * @param {string | undefined} input.inheritedToken the token an ancestor run
 *   exported, if any
 * @param {(pid: number) => boolean} input.isAlive
 * @param {number} input.now epoch ms
 * @returns {SlotDecision}
 */
export function decideMachineSlot({
  present,
  existing,
  dirMtimeMs,
  inheritedToken,
  isAlive,
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

  const startedAt = Number.isFinite(existing?.startedAt)
    ? /** @type {number} */ (existing?.startedAt)
    : dirMtimeMs;
  const age = Number.isFinite(startedAt) ? now - /** @type {number} */ (startedAt) : Number.NaN;
  const pastGrace = Number.isFinite(age) && age >= MIN_STALE_AGE_MS;

  if (existing === null) {
    // No readable record: the holder is mid-write, or crashed between mkdir
    // and write. Only the directory's age can tell which.
    return pastGrace
      ? { action: 'steal', reason: 'the machine slot has no readable owner record and is older than a minute - reclaiming it' }
      : { action: 'wait', reason: 'the machine slot is being taken by another run' };
  }

  const lock = decideGateLock({
    existing: {
      runId: existing.token ?? `pid-${existing.pid}`,
      pid: existing.pid,
      project: existing.command ?? 'unknown',
      startedAt: /** @type {number} */ (startedAt),
    },
    env: {},
    isAlive,
    now,
  });
  if (lock.action === 'steal' && pastGrace) {
    return {
      action: 'steal',
      reason: `the machine slot's holder (pid ${existing.pid}) is gone or past the 3 h cap - reclaiming it`,
    };
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
 * @returns {{ present: boolean, existing: SlotRecord | null, dirMtimeMs: number | null }}
 */
export function readSlot(dir) {
  const stats = statSync(dir, { throwIfNoEntry: false });
  if (!stats) {
    return { present: false, existing: null, dirMtimeMs: null };
  }
  return {
    present: true,
    existing: readRecord(path.join(dir, OWNER_FILE)),
    dirMtimeMs: stats.mtimeMs,
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
 * @param {(pid: number) => boolean} [options.isAlive]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.pollMs]
 * @param {number} [options.pid]
 * @param {string} [options.cwd]
 * @param {() => readonly number[]} [options.listAncestors] pids of this
 *   process's ancestors; asked once, only when the run would queue
 * @returns {Promise<HeldSlot>}
 */
export async function acquireMachineSlot({
  dir,
  env,
  command,
  log,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  isAlive = pidAlive,
  timeoutMs = timeoutFromEnv(env),
  pollMs = DEFAULT_POLL_MS,
  pid = process.pid,
  cwd = process.cwd(),
  listAncestors = ancestorPids,
}) {
  const noop = () => {};
  if (dir === null) {
    return { outcome: 'off', release: noop };
  }
  const start = now();
  let lastReminder = Number.NEGATIVE_INFINITY;
  /** @type {readonly number[] | null} */
  let ancestors = null;

  for (;;) {
    const seen = readSlot(dir);
    const decision = decideMachineSlot({
      ...seen,
      inheritedToken: env[SLOT_HELD_ENV],
      isAlive,
      now: now(),
    });

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
        return { outcome: 'acquired', release: () => releaseSlot(dir, token) };
      }
      continue;
    }
    if (decision.action === 'steal') {
      const result = stealSlot(dir, seen.existing);
      if (result === 'stolen') {
        log(`machine slot: ${decision.reason}`);
      } else if (result === 'displaced') {
        log(`machine slot: WARNING - moved a live holder's slot aside and could not put it back; two runs may now share the machine`);
      }
      continue;
    }

    // wait - unless the holder is one of our own ancestors: a shell that
    // took the slot around this gate without exporting its token. Queueing
    // would wait for our own parent until the timeout.
    if (seen.existing !== null) {
      ancestors ??= safeAncestors(listAncestors);
      if (ancestors.includes(seen.existing.pid)) {
        log(
          `machine slot: ERROR - the slot is held by pid ${seen.existing.pid}, an ANCESTOR of this run, ` +
            `so waiting would wait for itself. A shell must not create ${dir} around a node gate; ` +
            `the gate takes the slot itself. If it must, export ${SLOT_HELD_ENV} equal to the token it wrote.`
        );
        return { outcome: 'held-by-ancestor', release: noop };
      }
    }
    const t = now();
    const waited = t - start;
    if (waited >= timeoutMs) {
      log(
        `machine slot: gave up after ${Math.round(timeoutMs / 60_000)} min in the queue; ${decision.reason}. ` +
          `Re-run later, or raise ${SLOT_TIMEOUT_ENV}.`
      );
      return { outcome: 'timed-out', release: noop };
    }
    if (t - lastReminder >= REMIND_EVERY_MS) {
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
 * The pids of this process's ancestors, nearest first. One process listing
 * (PowerShell on Windows, `ps` elsewhere), asked only when a run is about to
 * queue. On any failure, just the direct parent.
 *
 * @returns {number[]}
 */
export function ancestorPids() {
  /** @type {Map<number, number>} */
  const parentOf = new Map();
  try {
    const text =
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
    for (const line of text.split(/\r?\n/)) {
      const [child, parent] = line.trim().split(/\s+/).map(Number);
      if (Number.isInteger(child) && Number.isInteger(parent)) {
        parentOf.set(child, parent);
      }
    }
  } catch {
    return [process.ppid];
  }
  /** @type {number[]} */
  const chain = [];
  let current = process.pid;
  for (let i = 0; i < 64; i++) {
    const parent = parentOf.get(current);
    if (parent === undefined || parent <= 0 || chain.includes(parent)) {
      break;
    }
    chain.push(parent);
    current = parent;
  }
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
 * a run (past the 3 h cap) now belongs to someone else.
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
 * The CLI shells' one-liner: take the slot for this process, release it on
 * every way out, and exit 1 on a queue timeout.
 *
 * @param {string} command
 * @returns {Promise<void>}
 */
export async function holdMachineSlotForProcess(command) {
  const slot = await acquireMachineSlot({
    dir: resolveSlotDir(process.env),
    env: process.env,
    command,
    log: (line) => console.error(line),
  });
  if (slot.outcome === 'timed-out' || slot.outcome === 'held-by-ancestor') {
    process.exit(1);
  }
  process.on('exit', slot.release);
  for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
    process.on(signal, () => {
      slot.release();
      process.exit(130);
    });
  }
}
