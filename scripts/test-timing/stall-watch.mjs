// The no-output watchdog for one gate stage: the pure decisions. A stage
// whose process tree has printed nothing for the silence limit is killed and
// reported as STALLED with its own exit code, so a wedged worker cannot hold
// the machine slot until the slot's cap while every waiter reads the run as
// "still going". The spawning, piping and killing live in run-stage.mjs.
// See stall-watch.mjs.md.

/** Exit code of a stage the watchdog killed. */
export const STALL_EXIT = 124;

/** Minutes of silence before a stage is killed; `off` switches the watch off. */
export const STALL_ENV = 'GATE_STALL_MIN';

/** How often the watchdog looks at the clock, in ms; tests shorten it. */
export const STALL_POLL_ENV = 'GATE_STALL_POLL_MS';

/**
 * The default silence limit, in minutes. The longest healthy silence on
 * record is about 10 min (a cold framework lint, 589 s), and every unit
 * stage under `CI=1` is silent for nearly its whole length; 20 min leaves
 * twice the worst recorded case.
 */
export const DEFAULT_STALL_MIN = 20;

/** Default poll interval. The kill lands at most this long after the limit. */
export const STALL_POLL_MS = 5_000;

/** After a SIGTERM to the group, how long before the SIGKILL. */
export const STALL_KILL_GRACE_MS = 5_000;

/**
 * @param {string | undefined} raw
 * @returns {number | null} a positive number of minutes, else null
 */
function positiveMinutes(raw) {
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The silence limit for one stage run, in ms, or null when it is not watched.
 *
 * Not watched:
 * - a stage that is itself a package gate (`nestedGate`): its own leaf
 *   stages are watched one level down, which names the leaf that hung;
 * - any run with `GATE_STALL_MIN=off`;
 * - a FILTERED run (forwarded args), unless `GATE_STALL_MIN` is set to a
 *   positive number. A filtered sweep under `CI=1` can be silent for far
 *   longer than any gate stage (a 25-min investigation run printed nothing
 *   until it ended) and must not be killed for it; it opts in.
 *
 * Precedence for a watched run: `GATE_STALL_MIN`, then `stage.stallMinutes`,
 * then `DEFAULT_STALL_MIN`. A malformed or non-positive value falls back; it
 * never switches the watch off (only `off` does).
 *
 * @param {{ nestedGate?: boolean, stallMinutes?: number }} stage
 * @param {Record<string, string | undefined>} env
 * @param {{ filtered?: boolean }} [run]
 * @returns {number | null}
 */
export function stallLimitMs(stage, env, { filtered = false } = {}) {
  if (stage.nestedGate === true) return null;
  const raw = env[STALL_ENV];
  if (raw !== undefined && raw.trim().toLowerCase() === 'off') return null;
  const fromEnv = positiveMinutes(raw);
  if (filtered && fromEnv === null) return null;
  const fromStage =
    typeof stage.stallMinutes === 'number' &&
    Number.isFinite(stage.stallMinutes) &&
    stage.stallMinutes > 0
      ? stage.stallMinutes
      : null;
  return Math.round((fromEnv ?? fromStage ?? DEFAULT_STALL_MIN) * 60_000);
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {number} the poll interval in ms
 */
export function stallPollMs(env) {
  const value = Number(env[STALL_POLL_ENV]);
  return Number.isFinite(value) && value > 0 ? value : STALL_POLL_MS;
}

/**
 * A silence clock: `heard(now)` on every output chunk, `check(now)` on every
 * poll. It also tracks the longest silence, which calibrates the limit.
 *
 * @param {number} limitMs
 * @param {number} startMs
 */
export function silenceClock(limitMs, startMs) {
  let last = startMs;
  let longest = 0;
  return {
    /** @param {number} now */
    heard(now) {
      longest = Math.max(longest, now - last);
      last = Math.max(last, now);
    },
    /** @param {number} now @returns {{ silentMs: number, stalled: boolean }} */
    check(now) {
      const silentMs = Math.max(0, now - last);
      return { silentMs, stalled: silentMs >= limitMs };
    },
    /** @param {number} now @returns {number} longest silence so far, ms */
    longest(now) {
      return Math.max(longest, now - last);
    },
  };
}

/**
 * The calibration line is printed only past a quarter of the limit: every
 * unit stage under `CI=1` is silent for nearly its whole length (58 s at
 * most in a healthy cascade), so a lower threshold is noise on every stage.
 *
 * @param {number} longestMs
 * @param {number} limitMs
 * @returns {boolean}
 */
export function shouldReportSilence(longestMs, limitMs) {
  return longestMs > limitMs / 4;
}

/**
 * @param {string} stageName
 * @param {number} longestMs
 * @param {number} durationMs
 * @returns {string}
 */
export function silenceLine(stageName, longestMs, durationMs) {
  return `⏱ longest silence in ${stageName}: ${(longestMs / 60_000).toFixed(1)} min of ${(durationMs / 60_000).toFixed(1)} min (a stage is killed at ${STALL_ENV})`;
}

/**
 * The banner printed when the watchdog fires. With the fast-check time limit
 * in place a failing property stops at that limit, so a stall here is a real
 * hang: a predicate that never returns, a deadlock, a stuck worker or tool.
 *
 * @param {string} stageName
 * @param {number} silentMs
 * @param {{ killed: true } | { killed: false, error: string }} kill
 * @returns {string}
 */
export function stallMessage(stageName, silentMs, kill) {
  const min = (silentMs / 60_000).toFixed(1);
  const outcome = kill.killed
    ? `its process tree was killed (exit ${STALL_EXIT})`
    : `killing its process tree FAILED (${kill.error}); its processes may still be running - find and end them by hand (exit ${STALL_EXIT})`;
  return [
    '',
    `✖ STALLED: stage "${stageName}" printed nothing for ${min} min - ${outcome}.`,
    '  Not counted as a red test, and not a failing property still shrinking (those stop at the',
    '  fast-check time limit): a real hang - a test or tool call that never returns, a deadlock or',
    '  a stuck worker. To see which file: re-run that stage on its own, keeping CI=1; for a vitest',
    `  stage add a per-file reporter (pnpm run test:unit -- --reporter=verbose; set ${STALL_ENV}=<minutes>`,
    '  to watch that filtered run too). Do not retry it away: a second stall is a bug to file.',
    `  ${STALL_ENV}=<minutes> changes the limit, ${STALL_ENV}=off switches the watch off.`,
  ].join('\n');
}
