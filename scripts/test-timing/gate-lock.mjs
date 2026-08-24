// One gate run at a time, per working tree.
//
// The cascade and every package gate mutate shared state: each package's
// `build` stage rewrites its own `dist/`, and the packages downstream of it
// resolve their imports THROUGH that directory. Two runs in one tree therefore
// race on more than CPU — one can delete and rewrite the very files the other
// is mid-import of. Both symptoms look like flaky tests from the inside, which
// is what makes the situation worth a guard rather than a note: the honest
// diagnosis is less reachable than the wrong one.
//
// The guard REFUSES rather than queues. Waiting would hide the mistake and, on
// a gate that runs for ~25 minutes, hide it for a very long time.
//
// Re-entrancy is the part that has to be right. The root cascade runs each
// package's gate with `pnpm --filter <pkg> test`, which lands back in
// `run-gate.mjs`; those are the same run, not competitors. The outermost run
// stamps its id into the environment, children inherit it, and an inherited id
// means "re-enter, touch nothing".

import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

/** Env var carrying the outermost run's id down to the gates it spawns. */
export const GATE_RUN_ENV = 'GATE_RUN_ID';

/** Env var that lets a caller proceed anyway, loudly. */
export const GATE_ALLOW_CONCURRENT_ENV = 'GATE_ALLOW_CONCURRENT';

/**
 * Upper bound on a lock we will believe. Past this, the owner is assumed gone
 * whatever the pid says — pid reuse would otherwise wedge the gate forever,
 * with a cause nobody could reasonably guess.
 *
 * Sized well above the slowest observed full cascade (~23 min, 2026-08-15) so
 * a genuinely running gate is never stolen from.
 */
export const MAX_LOCK_AGE_MS = 3 * 60 * 60 * 1000;

/** File name, kept beside the other generated test-timing state. */
export const LOCK_FILE_NAME = '.gate-run.lock';

/**
 * @typedef {object} LockRecord
 * @property {string} runId id of the run that owns the tree
 * @property {number} pid owning process id
 * @property {string} project project whose gate took the lock
 * @property {number} startedAt epoch ms when the lock was taken
 */

/**
 * @typedef {object} LockDecision
 * @property {'acquire' | 'reenter' | 'steal' | 'refuse' | 'override'} action
 * @property {string} reason human-readable, shown when it is not `acquire`
 * @property {boolean} [overridden] set when GATE_ALLOW_CONCURRENT forced the
 *   decision. STRUCTURAL on purpose: run-gate.mjs used to detect this by
 *   regex-matching the reason PROSE, so rewording a sentence would have
 *   silently stopped the "the guard is off" warning from printing.
 */

/**
 * Pure decision: what should this run do about the lock it found?
 *
 * Kept free of I/O so every branch is testable without spawning processes or
 * writing files — the branches that matter are exactly the ones that are
 * awkward to reproduce for real (a dead owner, a stolen parent lock).
 *
 * @param {object} input
 * @param {LockRecord | null} input.existing lock currently on disk, if any
 * @param {Record<string, string | undefined>} input.env process environment
 * @param {(pid: number) => boolean} input.isAlive liveness probe for a pid
 * @param {number} input.now epoch ms
 * @returns {LockDecision}
 */
export function decideGateLock({ existing, env, isAlive, now }) {
  const override = env[GATE_ALLOW_CONCURRENT_ENV];
  if (typeof override === 'string' && override !== '' && override !== '0') {
    // AN OVERRIDING RUN DOES NOT TAKE OWNERSHIP when someone else holds the
    // lock. The first version returned `acquire` unconditionally, which
    // overwrote the incumbent's record and then DELETED it on exit — so an
    // opt-in override silently disarmed the guard for the next run, which had
    // not opted in to anything. A guard that can be switched off for someone
    // else is worse than one that cannot be switched off at all.
    if (existing !== null) {
      return {
        action: 'override',
        overridden: true,
        reason: `${GATE_ALLOW_CONCURRENT_ENV} set — concurrency guard override in effect; run ${existing.runId} (pid ${existing.pid}) still owns this tree and keeps its lock`,
      };
    }
    return {
      action: 'acquire',
      overridden: true,
      reason: `${GATE_ALLOW_CONCURRENT_ENV} set — concurrency guard override in effect, but nothing else owns this tree`,
    };
  }

  const inheritedRunId = env[GATE_RUN_ENV];
  const nested = typeof inheritedRunId === 'string' && inheritedRunId !== '';

  if (existing === null) {
    return nested
      ? {
          action: 'reenter',
          reason: `nested run ${inheritedRunId} found no lock — the parent released it already`,
        }
      : { action: 'acquire', reason: 'no other gate run owns this tree' };
  }

  const ownerGone =
    !isAliveSafely(isAlive, existing.pid) ||
    !Number.isFinite(existing.startedAt) ||
    now - existing.startedAt > MAX_LOCK_AGE_MS;

  if (nested) {
    // A nested run never owns the lock, so it never steals one either. The only
    // question is whether the tree still belongs to the run it is part of.
    return existing.runId === inheritedRunId
      ? { action: 'reenter', reason: `part of run ${inheritedRunId}` }
      : {
          action: 'refuse',
          reason: `this gate belongs to run ${inheritedRunId}, but run ${existing.runId} now owns the tree`,
        };
  }

  return ownerGone
    ? {
        action: 'steal',
        reason: `previous run ${existing.runId} (pid ${existing.pid}) is gone — reclaiming its lock`,
      }
    : { action: 'refuse', reason: describeRefusal(existing, now) };
}

/**
 * The real liveness probe, and the reason it is here rather than inline at the
 * call site: `process.kill(pid, 0)` signals its answer by THROWING, and the two
 * throws mean opposite things — `ESRCH` is "no such process" (dead), `EPERM` is
 * "you may not signal it", which only a LIVE process can produce.
 *
 * Written inline in `run-gate.mjs` as `{ process.kill(pid, 0); return true }`
 * this returned "alive" for every dead pid, because the throw was swallowed by
 * the defensive wrapper below. The unit tests could not see it — they inject
 * the probe — so it survived until a stale lock was tried against a real gate.
 * Keeping the probe next to the rule it feeds is what makes it testable.
 *
 * @param {number} pid
 * @returns {boolean} whether a process with this pid currently exists
 */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error)?.code === 'EPERM';
  }
}

/**
 * Defensive wrapper around whatever probe was injected. Anything unexpected is
 * treated as "alive", so the guard errs towards refusing rather than towards
 * trampling a real run.
 *
 * @param {(pid: number) => boolean} isAlive
 * @param {number} pid
 * @returns {boolean}
 */
function isAliveSafely(isAlive, pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    return isAlive(pid);
  } catch {
    return true;
  }
}

/**
 * The refusal message. It has one job: leave the reader with a decision they
 * can act on, which means naming who holds the tree, for how long, and the
 * three ways out.
 *
 * @param {LockRecord} existing
 * @param {number} now epoch ms
 * @returns {string}
 */
export function describeRefusal(existing, now) {
  const pid = Number.isInteger(existing?.pid) ? existing.pid : 'unknown';
  const project =
    typeof existing?.project === 'string' && existing.project !== ''
      ? existing.project
      : 'an unknown project';
  const ageMs = Number.isFinite(existing?.startedAt)
    ? Math.max(0, now - existing.startedAt)
    : Number.NaN;
  const age = Number.isFinite(ageMs)
    ? `${Math.round(ageMs / 1000)} s ago`
    : 'at an unknown time';

  return [
    `another gate run already owns this working tree.`,
    `  owner:   ${project}, pid ${pid}, started ${age}`,
    ``,
    `  Two gate runs in one tree race on more than CPU: each package's build`,
    `  rewrites its own dist/, and the packages downstream import through it.`,
    `  The failures that produces look like flaky tests, not like this.`,
    ``,
    `  Wait for it to finish, or stop it, or — if you are certain the owner is`,
    `  gone — set ${GATE_ALLOW_CONCURRENT_ENV}=1 to proceed anyway.`,
  ].join('\n');
}

/**
 * @param {string} workspaceRoot
 * @returns {string} absolute path of the lock file
 */
export function lockPath(workspaceRoot) {
  return path.join(workspaceRoot, 'node_modules', '.cache', LOCK_FILE_NAME);
}

/**
 * Reads the lock, tolerating every way the file can be unusable — absent,
 * truncated by a killed writer, or hand-edited. An unreadable lock is treated
 * as no lock, because the alternative is a gate that cannot run at all until
 * someone finds and deletes a file they were never told about.
 *
 * @param {string} file
 * @returns {LockRecord | null}
 */
export function readLock(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      typeof parsed.runId !== 'string'
    ) {
      return null;
    }
    return /** @type {LockRecord} */ (parsed);
  } catch {
    return null;
  }
}

/**
 * Writes the lock record; with `exclusive`, the write IS the acquisition.
 *
 * `readLock → decideGateLock → writeLock` is not atomic: two gates starting
 * within the same few milliseconds each see `existing: null`, each decide
 * `acquire`, and each write — the second overwrites the first's record, both
 * believe they own the lock, and the first to finish clears it out from under
 * the one still running. `flag: 'wx'` makes the filesystem the arbiter: the
 * loser gets `EEXIST` and treats it as a refusal (PR #338 review). `steal`
 * keeps the plain overwrite — it has already established the previous owner
 * is gone, and an exclusive steal could never replace a dead owner's record.
 *
 * @param {string} file
 * @param {LockRecord} record
 * @param {{ exclusive?: boolean }} [options]
 * @returns {void}
 */
export function writeLock(file, record, { exclusive = false } = {}) {
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: 'utf8',
    ...(exclusive ? { flag: 'wx' } : {}),
  });
}

/**
 * @param {string} file
 * @returns {void}
 */
export function clearLock(file) {
  try {
    rmSync(file, { force: true });
  } catch {
    // Never fail a gate over lock cleanup: the staleness rules already cover a
    // lock that outlives its owner.
  }
}
