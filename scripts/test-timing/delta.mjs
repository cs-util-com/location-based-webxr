// Delta + flag computation for one stage's timing history (newest first).
// Noise rule agreed in the plan (§2/§5): a run is flagged slower/faster only
// when the change vs. the previous SAME-machine recording exceeds BOTH 20%
// AND 2s — raw numbers are always recorded, thresholds only drive display.

/**
 * @typedef {Object} TestCounts
 * @property {number} passed
 * @property {number} failed
 * @property {number} skipped
 * @property {number} todo
 */

/**
 * @typedef {Object} Recording
 * @property {string} ts - ISO timestamp
 * @property {number} durationMs
 * @property {TestCounts | null} tests
 * @property {string} machine - fingerprint `host-hash|cpu-slug|cores` (machine.mjs)
 * @property {string | null} git - short commit hash, null if unavailable
 */

/**
 * @typedef {Object} Delta
 * @property {'first' | 'baseline-reset' | 'compared'} kind
 * @property {'slower' | 'faster' | 'same' | null} flag - null unless compared
 * @property {number} [deltaMs] - only when compared
 * @property {number} [pct] - deltaMs / previous duration, only when compared
 * @property {number | null} deltaTests - passed-count change, null if unknown
 */

const PCT_THRESHOLD = 0.2;
const ABS_THRESHOLD_MS = 2000;

/**
 * @param {Recording} entry
 * @returns {void}
 */
function assertValidEntry(entry) {
  if (
    !entry ||
    typeof entry.machine !== 'string' ||
    !Number.isFinite(entry.durationMs) ||
    entry.durationMs < 0
  ) {
    throw new TypeError(`Malformed timing recording: ${JSON.stringify(entry)}`);
  }
}

/**
 * Computes the display delta for the newest entry of a stage history.
 *
 * @param {readonly Recording[]} history - newest first, at least one entry
 * @returns {Delta}
 */
export function computeDelta(history) {
  if (!Array.isArray(history) || history.length === 0) {
    throw new TypeError('computeDelta requires a non-empty history');
  }
  const current = history[0];
  assertValidEntry(current);

  const previous = history
    .slice(1)
    .find((entry) => entry.machine === current.machine);
  if (history.length === 1) {
    return { kind: 'first', flag: null, deltaTests: null };
  }
  if (!previous) {
    return { kind: 'baseline-reset', flag: null, deltaTests: null };
  }
  assertValidEntry(previous);

  const deltaMs = current.durationMs - previous.durationMs;
  const pct = previous.durationMs > 0 ? deltaMs / previous.durationMs : 0;
  const exceedsBoth =
    Math.abs(deltaMs) > ABS_THRESHOLD_MS && Math.abs(pct) > PCT_THRESHOLD;
  const flag = exceedsBoth ? (deltaMs > 0 ? 'slower' : 'faster') : 'same';

  const deltaTests =
    current.tests && previous.tests
      ? current.tests.passed - previous.tests.passed
      : null;

  return { kind: 'compared', flag, deltaMs, pct, deltaTests };
}
