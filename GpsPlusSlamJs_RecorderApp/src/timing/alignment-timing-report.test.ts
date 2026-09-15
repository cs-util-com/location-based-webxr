import { describe, it, expect } from 'vitest';
import { buildTimingReport, buildTimingTable } from './alignment-timing-report';
import type { AlignmentTimingResult } from './alignment-timing-loop';
import type { TimingArm } from './alignment-timing-arms';

const arms: readonly TimingArm[] = [
  { id: 'shipped', label: 'shipped defaults', overrides: null },
  { id: 'w180', label: 'flat window', overrides: { recentWindowSeconds: 180 } },
];

const result: AlignmentTimingResult = {
  parameters: { fixCount: 300, ladder: [50, 100, 300], repeats: 5, warmups: 1 },
  arms: [
    {
      armId: 'shipped',
      segments: [
        {
          fromHistory: 0,
          toHistory: 50,
          midHistory: 25,
          fixCount: 50,
          medianMsPerFix: 0.0721,
          minMsPerFix: 0.07,
          msPerFixPerRepeat: [0.07, 0.0721, 0.08],
        },
        {
          fromHistory: 50,
          toHistory: 100,
          midHistory: 75,
          fixCount: 50,
          medianMsPerFix: 0.125,
          minMsPerFix: 0.12,
          msPerFixPerRepeat: [0.12, 0.125, 0.13],
        },
        {
          fromHistory: 100,
          toHistory: 300,
          midHistory: 200,
          fixCount: 200,
          medianMsPerFix: 0.318,
          minMsPerFix: 0.31,
          msPerFixPerRepeat: [0.31, 0.318, 0.33],
        },
      ],
      totalMedianMs: 90,
      totalMinMs: 88,
      totalMsPerRepeat: [88, 90, 93],
      warmupTotalMs: [140],
    },
    {
      armId: 'w180',
      segments: [
        {
          fromHistory: 0,
          toHistory: 50,
          midHistory: 25,
          fixCount: 50,
          medianMsPerFix: 0.07,
          minMsPerFix: 0.069,
          msPerFixPerRepeat: [0.069, 0.07, 0.071],
        },
        {
          fromHistory: 50,
          toHistory: 100,
          midHistory: 75,
          fixCount: 50,
          medianMsPerFix: 0.1,
          minMsPerFix: 0.09,
          msPerFixPerRepeat: [0.09, 0.1, 0.11],
        },
        {
          fromHistory: 100,
          toHistory: 300,
          midHistory: 200,
          fixCount: 200,
          medianMsPerFix: 0.15,
          minMsPerFix: 0.14,
          msPerFixPerRepeat: [0.14, 0.15, 0.16],
        },
      ],
      totalMedianMs: 50,
      totalMinMs: 48,
      totalMsPerRepeat: [48, 50, 52],
      warmupTotalMs: [70],
    },
  ],
};

const environment = {
  userAgent: 'FakeBrowser/1.0',
  hardwareConcurrency: 8,
  appVersion: '0.1.0',
  libraryVersion: '1.25.0',
  frameworkVersion: '2.0.0',
  buildCommit: 'abc1234',
};

function report() {
  return buildTimingReport({
    result,
    arms,
    environment,
    recording: { fileName: 'walk.zip', fixCount: 300, durationSeconds: 251 },
    generatedAt: '2026-09-15T18:42:00.000Z',
  });
}

describe('the timing report', () => {
  // Why this test matters: the JSON blob is the only thing that leaves the
  // device - by hand, by the owner. A figure whose configuration is not
  // beside it cannot be read weeks later, and re-deriving which arm was which
  // from four unlabelled columns is exactly the mistake that makes a
  // measurement worthless.
  it('carries every arm with the overrides it actually ran under', () => {
    const json = report();
    expect(json.arms.map((a) => a.armId)).toEqual(['shipped', 'w180']);
    expect(json.arms[0]?.overrides).toBeNull();
    expect(json.arms[1]?.overrides).toEqual({ recentWindowSeconds: 180 });
    expect(json.arms[1]?.label).toBe('flat window');
  });

  // Why this test matters: the standing rule is that every figure is printed
  // beside the parameters it rests on. These four are the page's parameters.
  it('carries the parameters, the recording and the device', () => {
    const json = report();
    expect(json.parameters).toEqual({
      fixCount: 300,
      ladder: [50, 100, 300],
      repeats: 5,
      warmups: 1,
    });
    expect(json.recording).toEqual({
      fileName: 'walk.zip',
      fixCount: 300,
      durationSeconds: 251,
    });
    expect(json.environment).toEqual(environment);
    expect(json.generatedAt).toBe('2026-09-15T18:42:00.000Z');
    expect(json.schema).toBe('alignment-timing/1');
  });

  // Why this test matters: the raw repeats are what lets a reader recompute
  // the median, spot a thermally throttled run, or notice that median and
  // minimum disagree. Dropping them would make the report unfalsifiable.
  it('keeps every raw repeat, including the discarded warm-up', () => {
    const json = report();
    expect(json.arms[0]?.totalMsPerRepeat).toEqual([88, 90, 93]);
    expect(json.arms[0]?.warmupTotalMs).toEqual([140]);
    expect(json.arms[0]?.segments[0]?.msPerFixPerRepeat).toEqual([
      0.07, 0.0721, 0.08,
    ]);
  });

  // Why this test matters: an arm the loop never ran, or a loop result with no
  // matching arm definition, means the page and the measurement disagree about
  // what was measured - silently mislabelling a column.
  it('refuses a result whose arms do not match the arm table', () => {
    expect(() =>
      buildTimingReport({
        result,
        arms: [arms[0]!],
        environment,
        recording: {
          fileName: 'walk.zip',
          fixCount: 300,
          durationSeconds: null,
        },
        generatedAt: '2026-09-15T18:42:00.000Z',
      })
    ).toThrow(/w180/);
  });
});

describe('the on-screen table', () => {
  // Why this test matters: the owner reads this on a phone. One row per arm
  // per segment, the stored history the figure is quoted at, and both
  // statistics - the median and the minimum agreeing is what says a cell is
  // trustworthy.
  it('has one row per arm per segment, with the midpoint history and both statistics', () => {
    const table = buildTimingTable(report());
    expect(table.header).toEqual([
      'arm',
      'history',
      'mid M',
      'ms/fix (median)',
      'ms/fix (min)',
      'repeats',
    ]);
    expect(table.rows).toHaveLength(6);
    expect(table.rows[0]).toEqual([
      'shipped defaults',
      '0→50',
      '25',
      '0.072',
      '0.070',
      '5',
    ]);
    expect(table.rows[2]).toEqual([
      'shipped defaults',
      '100→300',
      '200',
      '0.318',
      '0.310',
      '5',
    ]);
  });

  // Why this test matters: a table without its parameters is a set of numbers
  // nobody can act on, and the caption is where they are cheapest to read.
  it('captions itself with the parameters the run used', () => {
    const table = buildTimingTable(report());
    expect(table.caption).toContain('300 fixes');
    expect(table.caption).toContain('50 / 100 / 300');
    expect(table.caption).toContain('median and minimum of 5');
    expect(table.caption).toContain('1 warm-up');
  });

  // Why this test matters: the totals are the figure a budget is built from,
  // and the per-arm ratio against shipped is the one comparison the preset
  // decision actually needs.
  it('summarises each arm against the shipped one', () => {
    const table = buildTimingTable(report());
    expect(table.totals).toEqual([
      ['shipped defaults', '90.000', '88.000', '1.00x'],
      ['flat window', '50.000', '48.000', '0.56x'],
    ]);
  });
});
