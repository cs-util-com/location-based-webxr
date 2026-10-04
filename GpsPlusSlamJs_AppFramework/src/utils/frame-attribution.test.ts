/**
 * Tests for the hitch attribution join (globe zoom performance plan
 * 2026-10-03-2017, §4.1 "Attribution rule", review Major 5).
 *
 * Why this file matters: the recorder's job is to say WHICH cause made the
 * owner's frames drop (an E step, a shader compile, a burst of tile
 * loads). The rule was stated before measuring: an event counts for a
 * hitch when it falls in the hitch frame or the `lag` frames before it; a
 * cause is supported when it is at least `k` times more frequent among
 * hitch frames than among normal ones AND present in at least 5 hitch
 * frames; every verdict is swept over threshold x lag x k, and a cause
 * supported at only some of those is provisional. A slip here names the
 * wrong fix.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  ATTRIBUTION_KS,
  ATTRIBUTION_LAGS,
  ATTRIBUTION_MIN_HITCH_FRAMES,
  attributionVerdicts,
  createHitchAttribution,
  poolAttributionCounts,
  type CauseVerdict,
} from './frame-attribution.js';

/** A run: `n` frames of 16 ms, with the given frames slow and events placed. */
function run(
  n: number,
  slow: ReadonlyMap<number, number>,
  events: ReadonlyMap<number, readonly string[]>,
  options: Parameters<typeof createHitchAttribution>[0] = {}
) {
  const a = createHitchAttribution(options);
  for (let i = 0; i < n; i++)
    a.endFrame(slow.get(i) ?? 16, events.get(i) ?? []);
  return a.counts();
}

/** The rule counted the slow way: [hitch frames, normal frames] whose window holds `kind`. */
function recount(
  frames: readonly { ms: number; events: readonly string[] }[],
  kind: string,
  lag: number,
  thresholdMs: number
): [number, number] {
  let inHitch = 0;
  let inNormal = 0;
  frames.forEach((f, i) => {
    const seen = frames
      .slice(Math.max(0, i - lag), i + 1)
      .some((g) => g.events.includes(kind));
    if (seen && f.ms > thresholdMs) inHitch++;
    else if (seen) inNormal++;
  });
  return [inHitch, inNormal];
}

const byKind = (verdicts: readonly CauseVerdict[], kind: string) =>
  verdicts.find((v) => v.kind === kind);

describe('the declared parameters', () => {
  it('match the plan: k 3/5/10, lag 0/1/2, at least 5 hitch frames', () => {
    expect(ATTRIBUTION_KS).toEqual([3, 5, 10]);
    expect(ATTRIBUTION_LAGS).toEqual([0, 1, 2]);
    expect(ATTRIBUTION_MIN_HITCH_FRAMES).toBe(5);
  });
});

describe('createHitchAttribution', () => {
  it('counts hitch and normal frames per threshold', () => {
    const counts = run(
      10,
      new Map([
        [2, 40],
        [5, 60],
        [7, 120],
      ]),
      new Map()
    );
    expect(counts.frames).toBe(10);
    expect(counts.hitchFrames).toEqual([3, 2, 1]);
  });

  // An event in frame i counts for frame i + lag: an E step's load wave
  // and a resolved promise land a frame or two after their cause.
  it('joins an event to the frames up to `lag` after it', () => {
    const counts = run(6, new Map([[3, 70]]), new Map([[1, ['e-step']]]), {
      thresholdsMs: [50],
    });
    const k = counts.kinds['e-step']!;
    // lag 0: only frame 1; lag 1: frames 1-2; lag 2: frames 1-3.
    expect(k.inHitch[0]).toEqual([0, 0, 1]);
    expect(k.inNormal[0]).toEqual([1, 2, 2]);
  });

  it('counts an event once per window however often it fired', () => {
    const counts = run(
      3,
      new Map([[2, 70]]),
      new Map<number, readonly string[]>([
        [1, ['load', 'load']],
        [2, ['load', 'load', 'load']],
      ]),
      { thresholdsMs: [50] }
    );
    expect(counts.kinds['load']!.inHitch[0]).toEqual([1, 1, 1]);
  });

  it('ignores a frame with a non-finite or negative interval, and empty event names', () => {
    const a = createHitchAttribution();
    expect(a.endFrame(Number.NaN, ['x'])).toBe(false);
    expect(a.endFrame(-3, ['x'])).toBe(false);
    expect(a.endFrame(16, ['', 'y'])).toBe(true);
    const c = a.counts();
    expect(c.frames).toBe(1);
    expect(c.rejected).toBe(2);
    expect(Object.keys(c.kinds)).toEqual(['y']);
  });

  it('refuses bad options', () => {
    expect(() => createHitchAttribution({ lags: [-1] })).toThrow(RangeError);
    expect(() => createHitchAttribution({ lags: [1.5] })).toThrow(RangeError);
    expect(() => createHitchAttribution({ lags: [] })).toThrow(RangeError);
    expect(() =>
      createHitchAttribution({ thresholdsMs: [Number.NaN] })
    ).toThrow(RangeError);
  });

  // The counts must equal a brute-force recount of the same rule over the
  // whole run, for any thresholds and lags (swept).
  it('agrees with a brute-force recount of the rule', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            ms: fc.constantFrom(8, 16, 34, 51, 120),
            events: fc.subarray(['a', 'b', 'c']),
          }),
          { maxLength: 120 }
        ),
        fc.uniqueArray(fc.integer({ min: 0, max: 4 }), {
          minLength: 1,
          maxLength: 3,
        }),
        (frames, lags) => {
          const thresholds = [33, 50, 100];
          const a = createHitchAttribution({ thresholdsMs: thresholds, lags });
          for (const f of frames) a.endFrame(f.ms, f.events);
          const c = a.counts();
          const sortedLags = [...lags].sort((x, y) => x - y);
          for (const [ti, t] of thresholds.entries()) {
            for (const [li, lag] of sortedLags.entries()) {
              for (const kind of ['a', 'b', 'c']) {
                const got = c.kinds[kind];
                expect([
                  got?.inHitch[ti]![li] ?? 0,
                  got?.inNormal[ti]![li] ?? 0,
                ]).toEqual(recount(frames, kind, lag, t));
              }
            }
          }
        }
      )
    );
  });
});

describe('poolAttributionCounts', () => {
  // A warm run that meets the target has at most 5 frames over 33 ms, so
  // one run alone can rarely reach the minimum of 5 hitch frames; the
  // three repeats of a sweep cell, or the whole sweep, pooled can.
  it('adds the counts of several runs', () => {
    const a = run(10, new Map([[3, 70]]), new Map([[3, ['x']]]));
    const b = run(
      5,
      new Map([[1, 70]]),
      new Map([
        [1, ['x']],
        [2, ['y']],
      ])
    );
    const p = poolAttributionCounts([a, b]);
    expect(p.frames).toBe(15);
    expect(p.hitchFrames).toEqual([2, 2, 0]);
    expect(p.kinds['x']!.inHitch[0]).toEqual([2, 2, 2]);
    // y in b's frame 2 of 0-4: windows of frames 2 / 2-3 / 2-4.
    expect(p.kinds['y']!.inNormal[0]).toEqual([1, 2, 3]);
    expect(p.kinds['y']!.inHitch[0]).toEqual([0, 0, 0]);
  });

  // Pooling equals one run over the concatenated frames when no lag window
  // can reach across a run's start (lag 0), for any split.
  it('equals one concatenated run at lag 0 (property)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.array(
            fc.record({
              ms: fc.constantFrom(16, 40, 80, 150),
              events: fc.subarray(['a', 'b', 'c']),
            }),
            { maxLength: 40 }
          ),
          { minLength: 1, maxLength: 4 }
        ),
        (runs) => {
          const feed = (frames: (typeof runs)[number]) => {
            const x = createHitchAttribution({ lags: [0] });
            for (const f of frames) x.endFrame(f.ms, f.events);
            return x.counts();
          };
          const pooled = poolAttributionCounts(runs.map(feed));
          const whole = feed(runs.flat());
          const norm = (c: typeof whole) =>
            JSON.stringify({
              ...c,
              kinds: Object.fromEntries(
                Object.entries(c.kinds).sort(([p], [q]) => (p < q ? -1 : 1))
              ),
            });
          expect(norm(pooled)).toBe(norm(whole));
        }
      )
    );
  });

  it('refuses runs with different thresholds or lags, and an empty list', () => {
    const a = createHitchAttribution().counts();
    const b = createHitchAttribution({ lags: [0] }).counts();
    const c = createHitchAttribution({ thresholdsMs: [33] }).counts();
    expect(() => poolAttributionCounts([a, b])).toThrow(RangeError);
    expect(() => poolAttributionCounts([a, c])).toThrow(RangeError);
    expect(() => poolAttributionCounts([])).toThrow(RangeError);
  });
});

describe('attributionVerdicts', () => {
  // 1000 frames, 10 hitches; "compile" fires in 8 of the hitch frames and
  // in 2 normal ones; "tick" fires every other frame, so every
  // window of a hitch and of a normal frame alike sees it.
  const slow = new Map<number, number>();
  const events = new Map<number, string[]>();
  for (let i = 0; i < 10; i++) slow.set(100 * i + 50, 150);
  for (let i = 0; i < 8; i++) events.set(100 * i + 50, ['compile']);
  events.set(5, ['compile']);
  events.set(905, ['compile']);
  for (let i = 0; i < 1000; i += 2) {
    events.set(i, [...(events.get(i) ?? []), 'tick']);
  }
  const counts = run(1000, slow, events);

  it('supports a cause far more frequent in hitch frames, at every cell', () => {
    const v = byKind(attributionVerdicts(counts), 'compile')!;
    expect(v.status).toBe('supported');
    expect(v.supportedCells).toBe(v.totalCells);
    expect(v.totalCells).toBe(3 * 3 * 3);
  });

  it('does not support a background event that is as frequent everywhere', () => {
    const v = byKind(attributionVerdicts(counts), 'tick')!;
    expect(v.status).toBe('unsupported');
    expect(v.supportedCells).toBe(0);
  });

  it('ranks the strongest cause first', () => {
    expect(attributionVerdicts(counts)[0]!.kind).toBe('compile');
  });

  // Two coincidences never make a cause: below the minimum count of hitch
  // frames a cause is unsupported however large its ratio.
  it('needs the minimum number of hitch frames (swept 3/5/8)', () => {
    const fewSlow = new Map([
      [100, 150],
      [300, 150],
      [500, 150],
      [700, 150],
    ]);
    const fewEvents = new Map([
      [100, ['gc']],
      [300, ['gc']],
      [500, ['gc']],
      [700, ['gc']],
    ]);
    const c = run(1000, fewSlow, fewEvents);
    for (const [min, expected] of [
      [3, 'supported'],
      [5, 'unsupported'],
      [8, 'unsupported'],
    ] as const) {
      const v = byKind(attributionVerdicts(c, { minHitchFrames: min }), 'gc')!;
      expect(v.status).toBe(expected);
    }
  });

  // Supported at k = 3 and 5 but not at 10: a provisional verdict, which
  // names the cells that reverse it.
  it('marks a cause supported at only some cells as provisional', () => {
    const s = new Map<number, number>();
    const e = new Map<number, string[]>();
    // 20 hitches out of 1000 frames; "load" in 10 of them (rate 0.5) and in
    // 60 of the 980 normal frames (rate 0.061): ratio about 8.
    for (let i = 0; i < 20; i++) s.set(50 * i + 25, 150);
    for (let i = 0; i < 10; i++) e.set(50 * i + 25, ['load']);
    let placed = 0;
    for (let i = 0; i < 1000 && placed < 60; i += 7) {
      if (s.has(i) || s.has(i + 1) || s.has(i + 2)) continue;
      e.set(i, ['load']);
      placed++;
    }
    const v = byKind(
      attributionVerdicts(run(1000, s, e, { lags: [0] })),
      'load'
    )!;
    expect(v.status).toBe('provisional');
    const reversing = v.cells.filter((cell) => !cell.supported);
    expect(reversing.every((cell) => cell.k === 10)).toBe(true);
    expect(reversing.length).toBeGreaterThan(0);
  });

  it('gives an infinite ratio to an event never seen in a normal frame', () => {
    const c = run(
      100,
      new Map([
        [10, 150],
        [20, 150],
        [30, 150],
        [40, 150],
        [50, 150],
      ]),
      new Map([
        [10, ['x']],
        [20, ['x']],
        [30, ['x']],
        [40, ['x']],
        [50, ['x']],
      ]),
      { lags: [0] }
    );
    const v = byKind(attributionVerdicts(c), 'x')!;
    expect(v.cells.every((cell) => cell.ratio === Infinity)).toBe(true);
    expect(v.status).toBe('supported');
  });

  // When every frame is a hitch there is nothing to compare against: the
  // ratio is undefined (null) and nothing is supported.
  it('supports nothing when there are no normal frames', () => {
    const all = new Map<number, number>();
    const ev = new Map<number, string[]>();
    for (let i = 0; i < 20; i++) {
      all.set(i, 200);
      ev.set(i, ['x']);
    }
    const v = byKind(attributionVerdicts(run(20, all, ev)), 'x')!;
    expect(v.cells.every((cell) => cell.ratio === null)).toBe(true);
    expect(v.status).toBe('unsupported');
  });

  it('refuses bad verdict options', () => {
    expect(() => attributionVerdicts(counts, { ks: [] })).toThrow(RangeError);
    expect(() => attributionVerdicts(counts, { ks: [0] })).toThrow(RangeError);
    expect(() => attributionVerdicts(counts, { minHitchFrames: -1 })).toThrow(
      RangeError
    );
  });

  // A larger k can only remove support, never add it.
  it('is monotone in k', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            ms: fc.constantFrom(16, 40, 80),
            events: fc.subarray(['a', 'b']),
          }),
          { maxLength: 200 }
        ),
        (frames) => {
          const a = createHitchAttribution();
          for (const f of frames) a.endFrame(f.ms, f.events);
          const verdicts = attributionVerdicts(a.counts(), { ks: [2, 4, 8] });
          for (const v of verdicts) {
            for (const cell of v.cells.filter((c) => c.supported)) {
              const smallerK = v.cells.filter(
                (o) =>
                  o.thresholdMs === cell.thresholdMs &&
                  o.lag === cell.lag &&
                  o.k < cell.k
              );
              expect(smallerK.every((o) => o.supported)).toBe(true);
            }
          }
        }
      )
    );
  });
});
