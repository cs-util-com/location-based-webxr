// Why this test matters: the JSON block inside test-timings.md is the single
// source of truth for the whole feature. If parse/render drift or history
// bounding breaks, every future delta is computed against wrong data — and
// per the plan (§4), corruption must recover silently instead of failing
// the gate.
import { describe, it, expect } from 'vitest';
import {
  HISTORY_LIMIT,
  createEmptyStore,
  parseStore,
  appendRecording,
  medianSameMachineMs,
  renderMd,
} from './timing-store.mjs';

/**
 * @param {number} durationMs
 * @param {{ machine?: string, tests?: import('./delta.mjs').TestCounts | null, ts?: string }} [options]
 * @returns {import('./delta.mjs').Recording}
 */
function rec(
  durationMs,
  { machine = 'M1', tests = null, ts = '2026-07-02T14:32:05+02:00' } = {}
) {
  return { ts, durationMs, tests, machine, git: 'abc1234' };
}

const WRITE_META = {
  machineLabel: 'SIMON-PC (Ryzen, 32 threads)',
  branch: 'r/239',
};

describe('parseStore', () => {
  it('returns a fresh store without warning when the file does not exist yet', () => {
    const result = parseStore(null, 'GpsPlusSlamJs');
    expect(result.store).toEqual(createEmptyStore('GpsPlusSlamJs'));
    expect(result.recovered).toBe(false);
    expect(result.warning).toBeNull();
  });

  it('recovers with a warning when the JSON block is missing', () => {
    const result = parseStore('# Test Timings\n\nno block here\n', 'P');
    expect(result.store).toEqual(createEmptyStore('P'));
    expect(result.recovered).toBe(true);
    expect(result.warning).toMatch(/no JSON data block/);
  });

  it('recovers with a warning on corrupt JSON', () => {
    const result = parseStore('```json\n{not json]\n```\n', 'P');
    expect(result.recovered).toBe(true);
    expect(result.warning).toMatch(/not valid JSON/);
  });

  it('recovers with a warning on a schema mismatch (future version)', () => {
    const md = '```json\n{ "version": 2, "meta": {}, "stages": {} }\n```\n';
    const result = parseStore(md, 'P');
    expect(result.recovered).toBe(true);
    expect(result.warning).toMatch(/version-1 schema/);
  });

  it('recovers when a history entry is malformed (defensive against hand edits)', () => {
    const store = appendRecording(
      createEmptyStore('P'),
      'lint',
      rec(1000),
      WRITE_META
    );
    const corrupted = renderMd(store, ['lint']).replace(
      '"durationMs":1000',
      '"durationMs":"fast"'
    );
    const result = parseStore(corrupted, 'P');
    expect(result.recovered).toBe(true);
  });
});

describe('appendRecording', () => {
  it('prepends newest-first and bounds the history at HISTORY_LIMIT', () => {
    let store = createEmptyStore('P');
    for (let i = 1; i <= HISTORY_LIMIT + 2; i++) {
      store = appendRecording(store, 'test:unit', rec(i * 1000), WRITE_META);
    }
    const history = store.stages['test:unit'].history;
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history[0].durationMs).toBe((HISTORY_LIMIT + 2) * 1000);
  });

  it('does not mutate the input store', () => {
    const before = appendRecording(
      createEmptyStore('P'),
      'lint',
      rec(1000),
      WRITE_META
    );
    const snapshot = JSON.parse(JSON.stringify(before));
    appendRecording(before, 'lint', rec(2000), WRITE_META);
    expect(before).toEqual(snapshot);
  });

  it('updates meta.lastWrite from the recording and write metadata', () => {
    const store = appendRecording(
      createEmptyStore('P'),
      'lint',
      rec(1000),
      WRITE_META
    );
    expect(store.meta.lastWrite).toEqual({
      ts: '2026-07-02T14:32:05+02:00',
      machine: 'M1',
      machineLabel: WRITE_META.machineLabel,
      git: 'abc1234',
      branch: 'r/239',
    });
  });

  it('rejects malformed recordings with a TypeError', () => {
    expect(() =>
      appendRecording(
        createEmptyStore('P'),
        'lint',
        // @ts-expect-error deliberately malformed
        { ts: 1, durationMs: 'x' },
        WRITE_META
      )
    ).toThrow(TypeError);
  });
});

// Why these tests matter: the Median column is the noise context the pilot
// showed was missing — single-previous deltas both ghost-flag noisy stages
// (lint 🔻/🔺 on cold/warm variance) and hide sub-threshold drift (test:unit
// creeping 12.2→14.8 s). The median must only ever mix same-machine values.
describe('medianSameMachineMs', () => {
  it('is the duration itself for a single recording', () => {
    expect(medianSameMachineMs([rec(8400)])).toBe(8400);
  });

  it('is the middle value for an odd same-machine count', () => {
    expect(medianSameMachineMs([rec(3000), rec(9000), rec(1000)])).toBe(3000);
  });

  it('averages the two middle values for an even same-machine count', () => {
    expect(medianSameMachineMs([rec(41200), rec(40400)])).toBe(40800);
  });

  it('ignores entries from other machines than the newest entry', () => {
    const history = [
      rec(9000, { machine: 'M2' }),
      rec(1000, { machine: 'M1' }),
      rec(2000, { machine: 'M1' }),
    ];
    expect(medianSameMachineMs(history)).toBe(9000);
  });
});

describe('renderMd', () => {
  it('round-trips: parse(render(store)) equals store', () => {
    let store = createEmptyStore('GpsPlusSlamJs');
    store = appendRecording(
      store,
      'test:unit',
      rec(41200, { tests: { passed: 758, failed: 0, skipped: 2, todo: 0 } }),
      WRITE_META
    );
    store = appendRecording(store, 'typecheck', rec(12000), WRITE_META);
    const md = renderMd(store, ['typecheck', 'test:unit']);
    expect(parseStore(md, 'GpsPlusSlamJs').store).toEqual(store);
  });

  it('is byte-stable: identical stores render identically', () => {
    const store = appendRecording(
      createEmptyStore('P'),
      'lint',
      rec(8400),
      WRITE_META
    );
    expect(renderMd(store, ['lint'])).toBe(renderMd(store, ['lint']));
  });

  it('contains the do-not-edit header and one row per configured stage', () => {
    const store = appendRecording(
      createEmptyStore('P'),
      'lint',
      rec(8400),
      WRITE_META
    );
    const md = renderMd(store, ['format', 'lint']);
    expect(md).toContain('do not edit by hand');
    expect(md).toContain('| `format` | – | – | – | – | – | |');
    expect(md).toContain('| `lint` | 8.4 s | – | 8.4 s | – | – | |');
  });

  it('shows ≈ for an unflagged change and the full delta + flag for a regression', () => {
    let store = createEmptyStore('P');
    store = appendRecording(store, 'typecheck', rec(8600), WRITE_META);
    store = appendRecording(store, 'typecheck', rec(12000), WRITE_META);
    store = appendRecording(store, 'test:unit', rec(40400), WRITE_META);
    store = appendRecording(store, 'test:unit', rec(41200), WRITE_META);
    const md = renderMd(store, ['typecheck', 'test:unit']);
    expect(md).toContain(
      '| `typecheck` | 12.0 s | +3.4 s (+40 %) | 10.3 s | – | – | 🔺 slower |'
    );
    expect(md).toContain('| `test:unit` | 41.2 s | ≈ | 40.8 s | – | – | |');
  });

  it('marks a machine change as baseline reset', () => {
    let store = createEmptyStore('P');
    store = appendRecording(
      store,
      'lint',
      rec(1000, { machine: 'M1' }),
      WRITE_META
    );
    store = appendRecording(
      store,
      'lint',
      rec(9000, { machine: 'M2' }),
      WRITE_META
    );
    const md = renderMd(store, ['lint']);
    expect(md).toContain(
      '| `lint` | 9.0 s | – | 9.0 s | – | – | baseline reset |'
    );
  });

  it('renders the total row last, in bold, and renders unknown stages defensively', () => {
    let store = createEmptyStore('P');
    store = appendRecording(store, 'total', rec(118400), WRITE_META);
    store = appendRecording(store, 'not-in-order', rec(500), WRITE_META);
    const md = renderMd(store, ['lint']);
    expect(md).toContain('| **total** | 118.4 s |');
    expect(md).toContain('| `not-in-order` | 0.5 s |');
    const totalIndex = md.indexOf('**total**');
    const unknownIndex = md.indexOf('`not-in-order`');
    expect(totalIndex).toBeGreaterThan(unknownIndex);
  });

  it('renders test counts with skipped/todo only when non-zero', () => {
    let store = createEmptyStore('P');
    store = appendRecording(
      store,
      'test:unit',
      rec(1000, { tests: { passed: 758, failed: 0, skipped: 2, todo: 0 } }),
      WRITE_META
    );
    const md = renderMd(store, ['test:unit']);
    expect(md).toContain('| 758 passed, 2 skipped |');
  });

  it('lists the per-stage history series in seconds, newest first', () => {
    let store = createEmptyStore('P');
    store = appendRecording(store, 'test:unit', rec(40400), WRITE_META);
    store = appendRecording(store, 'test:unit', rec(41200), WRITE_META);
    const md = renderMd(store, ['test:unit']);
    expect(md).toContain('- `test:unit`: 41.2, 40.4');
  });

  // Why this test matters: the Latest table renders in gate order, so the
  // History section must too — an alphabetical sort puts `total` mid-list and
  // makes table↔history cross-referencing needlessly hard.
  it('lists the history series in gate order, extras next, total last — not alphabetically', () => {
    let store = createEmptyStore('P');
    store = appendRecording(store, 'total', rec(100000), WRITE_META);
    store = appendRecording(store, 'aaa-extra', rec(500), WRITE_META);
    store = appendRecording(store, 'typecheck', rec(2000), WRITE_META);
    store = appendRecording(store, 'check:dup', rec(1000), WRITE_META);
    const md = renderMd(store, ['typecheck', 'check:dup']);
    const bullets = md
      .split('\n')
      .filter((line) => line.startsWith('- `'))
      .map((line) => line.slice(3, line.indexOf('`', 3)));
    expect(bullets).toEqual(['typecheck', 'check:dup', 'aaa-extra', 'total']);
  });

  // Why these tests matter: history series print raw seconds; once a second
  // machine records, interleaved values read as wild variance unless entries
  // from another machine are visibly marked (delta logic is machine-aware,
  // the rendering must be too).
  it('marks history values from a different machine than the series newest entry with *', () => {
    let store = createEmptyStore('P');
    store = appendRecording(
      store,
      'lint',
      rec(1000, { machine: 'M1' }),
      WRITE_META
    );
    store = appendRecording(
      store,
      'lint',
      rec(9000, { machine: 'M2' }),
      WRITE_META
    );
    const md = renderMd(store, ['lint']);
    expect(md).toContain('- `lint`: 9.0, 1.0*');
    expect(md).toContain('marked *');
  });

  it('renders no markers and no legend when all entries share one machine', () => {
    let store = createEmptyStore('P');
    store = appendRecording(store, 'lint', rec(1000), WRITE_META);
    store = appendRecording(store, 'lint', rec(9000), WRITE_META);
    const md = renderMd(store, ['lint']);
    expect(md).toContain('- `lint`: 9.0, 1.0');
    expect(md).not.toContain('*');
  });

  // Why this test matters: pretty-printed JSON made one recorded gate run a
  // ~127-line diff (each entry spans 8–25 lines). One line per entry keeps
  // "every PR diff shows exactly what changed" reviewable: ~1 added line per
  // stage per run.
  it('serializes each history entry and the meta block on one line each', () => {
    let store = createEmptyStore('P');
    store = appendRecording(
      store,
      'test:unit',
      rec(41200, { tests: { passed: 758, failed: 0, skipped: 2, todo: 0 } }),
      WRITE_META
    );
    store = appendRecording(store, 'test:unit', rec(40400), WRITE_META);
    store = appendRecording(store, 'lint', rec(8400), WRITE_META);
    const md = renderMd(store, ['lint', 'test:unit']);
    const entryLines = md
      .split('\n')
      .filter((line) => line.trim().startsWith('{"ts":'));
    expect(entryLines).toHaveLength(3);
    for (const line of entryLines) {
      expect(line).toContain('"git":');
    }
    const metaLines = md
      .split('\n')
      .filter((line) => line.includes('"lastWrite":'));
    expect(metaLines).toHaveLength(1);
    expect(metaLines[0]).toContain('"machineLabel":');
  });
});
