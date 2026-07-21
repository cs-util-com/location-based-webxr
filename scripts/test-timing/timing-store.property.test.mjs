// Why this test matters: the md file is rewritten on every recorded run for
// months — serialize∘parse must be a perfect identity for ANY reachable
// store, and bounding must hold for ANY append sequence, or the data store
// slowly corrupts itself.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  HISTORY_LIMIT,
  createEmptyStore,
  parseStore,
  appendRecording,
  medianSameMachineMs,
  renderMd,
} from './timing-store.mjs';

const stageNameArb = fc.stringMatching(/^[a-z][a-z0-9:_-]{0,20}$/);

const countsArb = fc.option(
  fc.record({
    passed: fc.nat({ max: 5000 }),
    failed: fc.nat({ max: 10 }),
    skipped: fc.nat({ max: 50 }),
    todo: fc.nat({ max: 50 }),
  }),
  { nil: null }
);

const recordingArb = fc.record({
  ts: fc
    .integer({ min: 0, max: 4_000_000_000_000 })
    .map((t) => new Date(t).toISOString()),
  durationMs: fc.nat({ max: 100_000_000 }),
  tests: countsArb,
  machine: fc.constantFrom('M1|cpu|8', 'M2|cpu|32'),
  git: fc.option(fc.stringMatching(/^[0-9a-f]{7,9}$/), { nil: null }),
});

const appendSequenceArb = fc.array(
  fc.record({ stage: stageNameArb, recording: recordingArb }),
  { maxLength: 40 }
);

const WRITE_META = { machineLabel: 'M (cpu, 8 threads)', branch: 'main' };

/** @param {{stage: string, recording: import('./delta.mjs').Recording}[]} seq */
function buildStore(seq) {
  let store = createEmptyStore('P');
  for (const { stage, recording } of seq) {
    store = appendRecording(store, stage, recording, WRITE_META);
  }
  return store;
}

describe('timing-store properties', () => {
  it('serialize∘parse is the identity for any reachable store', () => {
    fc.assert(
      fc.property(appendSequenceArb, (seq) => {
        const store = buildStore(seq);
        const stageOrder = [...new Set(seq.map((s) => s.stage))];
        const md = renderMd(store, stageOrder);
        const parsed = parseStore(md, 'P');
        expect(parsed.recovered).toBe(false);
        expect(parsed.store).toEqual(store);
      })
    );
  });

  it('every history stays bounded for arbitrary append sequences', () => {
    fc.assert(
      fc.property(appendSequenceArb, (seq) => {
        const store = buildStore(seq);
        for (const stage of Object.values(store.stages)) {
          expect(stage.history.length).toBeLessThanOrEqual(HISTORY_LIMIT);
        }
      })
    );
  });

  it('lists every stage with data exactly once in the History section, in gate order with total last', () => {
    fc.assert(
      fc.property(appendSequenceArb, (seq) => {
        const store = buildStore(seq);
        const stageOrder = [...new Set(seq.map((s) => s.stage))].filter(
          (s) => s !== 'total'
        );
        const md = renderMd(store, stageOrder);
        const bullets = md
          .split('\n')
          .filter((line) => line.startsWith('- `'))
          .map((line) => line.slice(3, line.indexOf('`', 3)));
        const dataStages = Object.keys(store.stages);
        const expected = [
          ...stageOrder.filter((s) => dataStages.includes(s)),
          ...dataStages
            .filter((s) => s !== 'total' && !stageOrder.includes(s))
            .sort(),
          ...(store.stages['total'] ? ['total'] : []),
        ];
        expect(bullets).toEqual(expected);
      })
    );
  });

  it('marks exactly the history entries whose machine differs from their series newest entry', () => {
    // A small stage-name pool forces same-stage collisions so mixed-machine
    // histories (the interesting case) actually occur in most runs.
    const collidingSequenceArb = fc.array(
      fc.record({
        stage: fc.constantFrom('lint', 'test:unit', 'total'),
        recording: recordingArb,
      }),
      { maxLength: 40 }
    );
    fc.assert(
      fc.property(collidingSequenceArb, (seq) => {
        const store = buildStore(seq);
        const stageOrder = [...new Set(seq.map((s) => s.stage))].filter(
          (s) => s !== 'total'
        );
        const md = renderMd(store, stageOrder);
        const bulletText = md
          .split('\n')
          .filter((line) => line.startsWith('- `'))
          .join('');
        const starCount = bulletText.split('*').length - 1;
        const expected = Object.values(store.stages).reduce(
          (n, stage) =>
            n +
            stage.history.filter((e) => e.machine !== stage.history[0].machine)
              .length,
          0
        );
        expect(starCount).toBe(expected);
        expect(md.includes('marked *')).toBe(expected > 0);
      })
    );
  });

  it('median stays within [min, max] of the same-machine durations and ignores history order beyond the newest entry', () => {
    const historyArb = fc.array(recordingArb, { minLength: 1, maxLength: 10 });
    fc.assert(
      fc.property(historyArb, (history) => {
        const median = medianSameMachineMs(history);
        const sameMachine = history
          .filter((e) => e.machine === history[0].machine)
          .map((e) => e.durationMs);
        expect(median).toBeGreaterThanOrEqual(Math.min(...sameMachine));
        expect(median).toBeLessThanOrEqual(Math.max(...sameMachine));
        const shuffledTail = [history[0], ...history.slice(1).reverse()];
        expect(medianSameMachineMs(shuffledTail)).toBe(median);
      })
    );
  });

  it('serializes every history entry verbatim on its own line of the JSON block', () => {
    fc.assert(
      fc.property(appendSequenceArb, (seq) => {
        const store = buildStore(seq);
        const stageOrder = [...new Set(seq.map((s) => s.stage))];
        const md = renderMd(store, stageOrder);
        const trimmedLines = md
          .split('\n')
          .map((line) => line.trim().replace(/,$/, ''));
        for (const stage of Object.values(store.stages)) {
          for (const entry of stage.history) {
            expect(trimmedLines).toContain(JSON.stringify(entry));
          }
        }
        expect(trimmedLines).toContain(`"meta": ${JSON.stringify(store.meta)}`);
      })
    );
  });

  it('renders exactly one table row per configured stage plus data-only extras', () => {
    fc.assert(
      fc.property(appendSequenceArb, (seq) => {
        const store = buildStore(seq);
        const stageOrder = [...new Set(seq.map((s) => s.stage))].filter(
          (s) => s !== 'total'
        );
        const md = renderMd(store, stageOrder);
        const rowCount = md
          .split('\n')
          .filter(
            (line) => line.startsWith('| `') || line.startsWith('| **total**')
          ).length;
        const extras = Object.keys(store.stages).filter(
          (s) => s !== 'total' && !stageOrder.includes(s)
        );
        const totalRows = store.stages['total'] ? 1 : 0;
        expect(rowCount).toBe(stageOrder.length + extras.length + totalRows);
      })
    );
  });
});
