// Parses exact test counts out of the runners' JSON reporter output files.
// Counts come from machine-readable reporters, never stdout scraping — a
// schema change in a runner upgrade must fail loudly here (TypeError) so the
// recording layer can warn and record duration-only instead of lying.

/** @typedef {import('./delta.mjs').TestCounts} TestCounts */

/**
 * @param {string} label
 * @param {unknown} value
 * @returns {number}
 */
function requireFiniteNumber(label, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} is not a finite number: ${String(value)}`);
  }
  return value;
}

/**
 * @param {string} label
 * @param {string} jsonText
 * @returns {Record<string, unknown>}
 */
function parseObject(label, jsonText) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new TypeError(`${label} output is not valid JSON: ${String(error)}`, {
      cause: error,
    });
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new TypeError(`${label} output is not a JSON object`);
  }
  return /** @type {Record<string, unknown>} */ (parsed);
}

/**
 * Parses vitest's jest-compatible json reporter output.
 * `numPendingTests` is vitest's name for skipped tests.
 *
 * @param {string} jsonText
 * @returns {TestCounts}
 */
export function parseVitestCounts(jsonText) {
  const report = parseObject('vitest json reporter', jsonText);
  return {
    passed: requireFiniteNumber('numPassedTests', report.numPassedTests),
    failed: requireFiniteNumber('numFailedTests', report.numFailedTests ?? 0),
    skipped: requireFiniteNumber(
      'numPendingTests',
      report.numPendingTests ?? 0
    ),
    todo: requireFiniteNumber('numTodoTests', report.numTodoTests ?? 0),
  };
}

/**
 * Parses playwright's json reporter output. `expected` are passes,
 * `unexpected` are failures; flaky tests passed on retry and count as passed.
 *
 * @param {string} jsonText
 * @returns {TestCounts}
 */
export function parsePlaywrightCounts(jsonText) {
  const report = parseObject('playwright json reporter', jsonText);
  const stats = report.stats;
  if (stats === null || typeof stats !== 'object') {
    throw new TypeError('playwright json reporter output has no stats object');
  }
  const statsRecord = /** @type {Record<string, unknown>} */ (stats);
  const expected = requireFiniteNumber('stats.expected', statsRecord.expected);
  const flaky = requireFiniteNumber('stats.flaky', statsRecord.flaky ?? 0);
  return {
    passed: expected + flaky,
    failed: requireFiniteNumber(
      'stats.unexpected',
      statsRecord.unexpected ?? 0
    ),
    skipped: requireFiniteNumber('stats.skipped', statsRecord.skipped ?? 0),
    todo: 0,
  };
}
