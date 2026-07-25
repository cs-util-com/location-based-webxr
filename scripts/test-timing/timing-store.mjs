// Single source of truth for docs/test-timings.md: the fenced JSON block at
// the bottom of the file IS the store; the human-readable tables are re-
// rendered from it on every write, so data and view cannot drift. All
// functions are pure (no fs, no clock) — the shells own I/O and timestamps.

import { computeDelta } from './delta.mjs';

/** @typedef {import('./delta.mjs').Recording} Recording */
/** @typedef {import('./delta.mjs').TestCounts} TestCounts */

/**
 * @typedef {Object} LastWrite
 * @property {string} ts
 * @property {string} machine - fingerprint `host-hash|cpu-slug|cores` (machine.mjs)
 * @property {string} machineLabel - human-readable machine description
 * @property {string | null} git
 * @property {string | null} branch
 */

/**
 * @typedef {Object} Store
 * @property {1} version
 * @property {{ project: string, lastWrite: LastWrite | null }} meta
 * @property {Record<string, { history: Recording[] }>} stages
 */

/**
 * @typedef {Object} ParseResult
 * @property {Store} store
 * @property {boolean} recovered - true when the file was missing/corrupt and a fresh store was initialized
 * @property {string | null} warning
 */

export const HISTORY_LIMIT = 10;

/** Marker used to locate the machine-owned JSON block inside the md file. */
const JSON_BLOCK_RE = /```json\r?\n([\s\S]*?)\r?\n```/g;

/**
 * @param {string} project
 * @returns {Store}
 */
export function createEmptyStore(project) {
  return { version: 1, meta: { project, lastWrite: null }, stages: {} };
}

/**
 * @param {unknown} value
 * @returns {value is TestCounts}
 */
function isValidCounts(value) {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const counts = /** @type {Record<string, unknown>} */ (value);
  return ['passed', 'failed', 'skipped', 'todo'].every(
    (key) => typeof counts[key] === 'number' && Number.isFinite(counts[key])
  );
}

/**
 * @param {unknown} value
 * @returns {value is Recording}
 */
function isValidRecording(value) {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const entry = /** @type {Record<string, unknown>} */ (value);
  return (
    typeof entry.ts === 'string' &&
    typeof entry.durationMs === 'number' &&
    Number.isFinite(entry.durationMs) &&
    entry.durationMs >= 0 &&
    typeof entry.machine === 'string' &&
    (entry.git === null || typeof entry.git === 'string') &&
    (entry.tests === null || isValidCounts(entry.tests))
  );
}

/**
 * @param {unknown} value
 * @returns {value is Store}
 */
function isValidStore(value) {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const store = /** @type {Record<string, unknown>} */ (value);
  if (store.version !== 1) {
    return false;
  }
  const meta = /** @type {Record<string, unknown> | null} */ (store.meta);
  if (meta === null || typeof meta !== 'object') {
    return false;
  }
  if (typeof meta.project !== 'string') {
    return false;
  }
  const stages = store.stages;
  if (stages === null || typeof stages !== 'object') {
    return false;
  }
  return Object.values(stages).every(
    (stage) =>
      stage !== null &&
      typeof stage === 'object' &&
      Array.isArray(/** @type {{history?: unknown}} */ (stage).history) &&
      /** @type {{history: unknown[]}} */ (stage).history.every(
        isValidRecording
      )
  );
}

/**
 * Parses the store out of an existing test-timings.md. Missing or corrupt
 * content re-initializes an empty store (recording must never break the
 * gate), with a warning the caller should surface.
 *
 * @param {string | null} mdText - file content, or null when the file does not exist
 * @param {string} project
 * @returns {ParseResult}
 */
export function parseStore(mdText, project) {
  if (mdText === null) {
    return {
      store: createEmptyStore(project),
      recovered: false,
      warning: null,
    };
  }
  const matches = [...mdText.matchAll(JSON_BLOCK_RE)];
  const lastMatch = matches.at(-1);
  if (!lastMatch) {
    return {
      store: createEmptyStore(project),
      recovered: true,
      warning: 'test-timings.md has no JSON data block — starting fresh',
    };
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(lastMatch[1]);
  } catch {
    return {
      store: createEmptyStore(project),
      recovered: true,
      warning: 'test-timings.md JSON block is not valid JSON — starting fresh',
    };
  }
  if (!isValidStore(parsed)) {
    return {
      store: createEmptyStore(project),
      recovered: true,
      warning:
        'test-timings.md JSON block does not match the version-1 schema — starting fresh',
    };
  }
  return { store: parsed, recovered: false, warning: null };
}

/**
 * Returns a new store with the recording prepended to the stage's history
 * (newest first), bounded to HISTORY_LIMIT, and meta.lastWrite updated.
 * The input store is not mutated.
 *
 * @param {Store} store
 * @param {string} stageName
 * @param {Recording} recording
 * @param {{ machineLabel: string, branch: string | null }} writeMeta
 * @returns {Store}
 */
export function appendRecording(store, stageName, recording, writeMeta) {
  if (!isValidRecording(recording)) {
    throw new TypeError(
      `Malformed recording for stage "${stageName}": ${JSON.stringify(recording)}`
    );
  }
  const existing = store.stages[stageName]?.history ?? [];
  return {
    ...store,
    meta: {
      ...store.meta,
      lastWrite: {
        ts: recording.ts,
        machine: recording.machine,
        machineLabel: writeMeta.machineLabel,
        git: recording.git,
        branch: writeMeta.branch,
      },
    },
    stages: {
      ...store.stages,
      [stageName]: {
        history: [recording, ...existing].slice(0, HISTORY_LIMIT),
      },
    },
  };
}

/**
 * @param {number} ms
 * @returns {string}
 */
export function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Median duration over the history entries recorded on the same machine as
 * the newest entry (including it). Pure display context against noise —
 * flags keep comparing against the single previous same-machine run.
 *
 * @param {readonly Recording[]} history - newest first, at least one entry
 * @returns {number} median duration in ms
 */
export function medianSameMachineMs(history) {
  if (!Array.isArray(history) || history.length === 0) {
    throw new TypeError('medianSameMachineMs requires a non-empty history');
  }
  const durations = history
    .filter((entry) => entry.machine === history[0].machine)
    .map((entry) => entry.durationMs)
    .sort((a, b) => a - b);
  const mid = Math.floor(durations.length / 2);
  return durations.length % 2 === 1
    ? durations[mid]
    : (durations[mid - 1] + durations[mid]) / 2;
}

/**
 * @param {number} deltaMs
 * @param {number} pct
 * @returns {string}
 */
function formatDelta(deltaMs, pct) {
  const sign = deltaMs >= 0 ? '+' : '−';
  const pctSign = pct >= 0 ? '+' : '−';
  const pctText = `${pctSign}${Math.round(Math.abs(pct) * 100)} %`;
  return `${sign}${(Math.abs(deltaMs) / 1000).toFixed(1)} s (${pctText})`;
}

/**
 * @param {TestCounts | null} tests
 * @returns {string}
 */
function formatCounts(tests) {
  if (tests === null) {
    return '–';
  }
  const parts = [`${tests.passed} passed`];
  if (tests.skipped > 0) {
    parts.push(`${tests.skipped} skipped`);
  }
  if (tests.todo > 0) {
    parts.push(`${tests.todo} todo`);
  }
  return parts.join(', ');
}

/**
 * Serializes the store as plain JSON with one line per history entry (and
 * one line for `meta`), so a recorded run diffs as ~one added line per stage
 * instead of an 8–25 line pretty-printed blob. Only whitespace differs from
 * `JSON.stringify` — `JSON.parse`/`parseStore` are unaffected.
 *
 * @param {Store} store
 * @returns {string}
 */
function serializeStore(store) {
  const lines = [];
  lines.push('{');
  lines.push(`  "version": ${JSON.stringify(store.version)},`);
  lines.push(`  "meta": ${JSON.stringify(store.meta)},`);
  const stageNames = Object.keys(store.stages);
  if (stageNames.length === 0) {
    lines.push('  "stages": {}');
  } else {
    lines.push('  "stages": {');
    stageNames.forEach((name, stageIndex) => {
      const history = store.stages[name]?.history ?? [];
      const stageComma = stageIndex < stageNames.length - 1 ? ',' : '';
      if (history.length === 0) {
        lines.push(
          `    ${JSON.stringify(name)}: { "history": [] }${stageComma}`
        );
        return;
      }
      lines.push(`    ${JSON.stringify(name)}: { "history": [`);
      history.forEach((entry, entryIndex) => {
        const entryComma = entryIndex < history.length - 1 ? ',' : '';
        lines.push(`      ${JSON.stringify(entry)}${entryComma}`);
      });
      lines.push(`    ] }${stageComma}`);
    });
    lines.push('  }');
  }
  lines.push('}');
  return lines.join('\n');
}

/**
 * Renders one table row; empty cells collapse to `| |` instead of `|  |`.
 * @param {string[]} cells
 * @returns {string}
 */
function renderCells(cells) {
  return `|${cells.map((cell) => (cell ? ` ${cell} ` : ' ')).join('|')}|`;
}

/**
 * Renders one Latest-table row for a stage.
 * @param {string} label
 * @param {Recording[] | undefined} history
 * @returns {string}
 */
function renderRow(label, history) {
  if (!history || history.length === 0) {
    return renderCells([label, '–', '–', '–', '–', '–', '']);
  }
  const latest = history[0];
  const delta = computeDelta(history);
  /** @type {string} */
  let deltaText;
  /** @type {string} */
  let flagText;
  if (delta.kind === 'compared') {
    const deltaMs = /** @type {number} */ (delta.deltaMs);
    const pct = /** @type {number} */ (delta.pct);
    deltaText = delta.flag === 'same' ? '≈' : formatDelta(deltaMs, pct);
    flagText =
      delta.flag === 'slower'
        ? '🔺 slower'
        : delta.flag === 'faster'
          ? '🔻 faster'
          : '';
  } else {
    deltaText = '–';
    flagText = delta.kind === 'baseline-reset' ? 'baseline reset' : '';
  }
  const deltaTestsText =
    delta.deltaTests === null
      ? '–'
      : delta.deltaTests > 0
        ? `+${delta.deltaTests}`
        : `${delta.deltaTests}`;
  return renderCells([
    label,
    formatSeconds(latest.durationMs),
    deltaText,
    formatSeconds(medianSameMachineMs(history)),
    formatCounts(latest.tests),
    deltaTestsText,
    flagText,
  ]);
}

/**
 * Renders the full test-timings.md from the store. Pure and byte-stable:
 * identical stores render to identical text.
 *
 * @param {Store} store
 * @param {readonly string[]} stageOrder - display order, excluding 'total'
 * @returns {string}
 */
export function renderMd(store, stageOrder) {
  const lines = [];
  lines.push(`# Test Timings — ${store.meta.project}`);
  lines.push('');
  lines.push(
    '<!-- Generated by scripts/test-timing/ — do not edit by hand. See docs/2026-07-02-test-timing-history-plan.md -->'
  );
  lines.push('');
  lines.push('## Latest');
  lines.push('');
  const lastWrite = store.meta.lastWrite;
  if (lastWrite) {
    const gitPart = lastWrite.git ? ` @ \`${lastWrite.git}\`` : '';
    const branchPart = lastWrite.branch
      ? ` · branch \`${lastWrite.branch}\``
      : '';
    lines.push(
      `Last recorded ${lastWrite.ts} · machine \`${lastWrite.machineLabel}\`${branchPart}${gitPart}`
    );
    lines.push('');
    lines.push(
      "_Header describes the most recent write only; standalone stage runs update single rows. Median = the stage's same-machine history median. Per-recording provenance lives in the JSON block._"
    );
    lines.push('');
  }
  lines.push(
    '| Stage | Duration | Δ duration | Median | Tests | Δ tests | Flag |'
  );
  lines.push('| --- | ---: | ---: | ---: | --- | ---: | --- |');
  const knownStages = new Set([...stageOrder, 'total']);
  for (const stage of stageOrder) {
    lines.push(renderRow(`\`${stage}\``, store.stages[stage]?.history));
  }
  // Defensive: stages present in the data but missing from the configured
  // order still render (alphabetically) instead of silently disappearing.
  for (const stage of Object.keys(store.stages).sort()) {
    if (!knownStages.has(stage)) {
      lines.push(renderRow(`\`${stage}\``, store.stages[stage]?.history));
    }
  }
  if (store.stages['total']) {
    lines.push(renderRow('**total**', store.stages['total'].history));
  }
  lines.push('');
  lines.push(
    `## History (last ${HISTORY_LIMIT} recordings per stage, newest first, seconds)`
  );
  lines.push('');
  // Same ordering as the Latest table (gate order, data-only extras, total
  // last) so table↔history cross-referencing is effortless.
  const dataStages = Object.keys(store.stages);
  const historyOrder = [
    ...stageOrder.filter((s) => s !== 'total' && dataStages.includes(s)),
    ...dataStages.filter((s) => s !== 'total' && !knownStages.has(s)).sort(),
    ...(store.stages['total'] ? ['total'] : []),
  ];
  // Raw seconds from different machines are not comparable — mark entries
  // whose machine differs from their series' newest entry so interleaved
  // values are not misread as variance.
  const bullets = [];
  let hasCrossMachineEntries = false;
  for (const stage of historyOrder) {
    const history = store.stages[stage]?.history ?? [];
    const series = history
      .map((entry) => {
        const marker = entry.machine === history[0].machine ? '' : '*';
        hasCrossMachineEntries = hasCrossMachineEntries || marker !== '';
        return `${(entry.durationMs / 1000).toFixed(1)}${marker}`;
      })
      .join(', ');
    bullets.push(`- \`${stage}\`: ${series}`);
  }
  if (hasCrossMachineEntries) {
    lines.push(
      "_Values marked * were recorded on a different machine than their series' newest entry (fingerprints in the JSON block)._"
    );
    lines.push('');
  }
  lines.push(...bullets);
  lines.push('');
  lines.push('```json');
  lines.push(serializeStore(store));
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}
