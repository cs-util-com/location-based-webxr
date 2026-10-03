/**
 * Tests for the recorder's phone-readable summary and its export (globe
 * zoom performance plan 2026-10-03-2017, §4.1 "Usable on a phone" and
 * "The export"; DEC-PERF-1, DEC-PERF-3).
 *
 * Why this file matters: the owner runs the recorder on a PHONE and reads
 * the summary at phone width, then pastes the export into a chat. The
 * summary must show p50 / p95 / p99 / max, the counts over 33 / 50 / 100
 * ms, PASS or FAIL against DEC-PERF-3 with the handful at 3 / 5 / 10, and
 * the strongest causes; the export must be valid JSON (no NaN or Infinity,
 * which JSON cannot carry), small enough to paste, and carry the raw
 * counts so any verdict can be recomputed.
 */
import { describe, expect, it } from 'vitest';

import { createFrameRun, type FrameRunSummary } from './frame-run.js';
import {
  FRAME_EXPORT_SCHEMA,
  SUMMARY_MAX_LINE_CHARS,
  buildFrameExport,
  formatFrameRunSummary,
  type FrameExport,
} from './frame-run-report.js';

/** A run of `n` frames at 16.7 ms with the given slow frames and events. */
function summaryOf(
  n: number,
  slow: Record<number, number> = {},
  events: Record<number, string[]> = {},
  refreshIntervalMs: number | null = null
): FrameRunSummary {
  const r = createFrameRun({ refreshIntervalMs });
  for (let i = 0; i < n; i++) r.endFrame(slow[i] ?? 16.7, events[i] ?? []);
  return r.summary();
}

/** Ten frames over 50 ms, each with an E step: a supported cause. */
function hitchyRun(): FrameRunSummary {
  const slow: Record<number, number> = {};
  const events: Record<number, string[]> = {};
  for (let i = 0; i < 10; i++) {
    slow[200 * i + 100] = 120;
    events[200 * i + 100] = ['e-step'];
    events[200 * i + 7] = ['load-model'];
  }
  return summaryOf(2000, slow, events, 1000 / 60);
}

describe('formatFrameRunSummary', () => {
  it('passes a clean run and shows the percentiles and counts', () => {
    const text = formatFrameRunSummary('alps 1/3', summaryOf(600, { 10: 40 }));
    expect(text).toContain('alps 1/3');
    expect(text).toContain('600 frames');
    expect(text).toContain('p50 16.7 · p95 16.7 · p99 16.7 ms');
    expect(text).toContain('max 40.0 ms');
    expect(text).toContain('>33 1 · >50 0 · >100 0');
    expect(text).toContain('PASS');
    expect(text).toContain('handful 3 PASS · 5 PASS · 10 PASS');
  });

  it('fails a run with a frame over 50 ms and names the strongest cause', () => {
    const text = formatFrameRunSummary('ocean', hitchyRun());
    expect(text).toContain('FAIL');
    expect(text).toContain('>33 10 · >50 10 · >100 10');
    expect(text).toMatch(/1\. e-step supported 27\/27/);
    expect(text).toContain('60.0 Hz');
    expect(text).toMatch(/dropped \d+/);
  });

  it('says so when no cause is supported', () => {
    expect(formatFrameRunSummary('x', summaryOf(100))).toContain(
      'causes: none supported'
    );
  });

  it('shows a refused interval count only when there is one', () => {
    const r = createFrameRun();
    r.endFrame(16);
    expect(formatFrameRunSummary('x', r.summary())).not.toContain('refused');
    r.endFrame(Number.NaN);
    expect(formatFrameRunSummary('x', r.summary())).toContain('refused 1');
  });

  it('reads an empty run without inventing numbers', () => {
    const text = formatFrameRunSummary('empty', createFrameRun().summary());
    expect(text).toContain('0 frames');
    expect(text).toContain('p50 -');
  });

  // Phone width (DEC-PERF-1): no line wider than the declared limit,
  // whatever the label and event names, swept over long inputs.
  it('keeps every line within the phone-width limit', () => {
    expect(SUMMARY_MAX_LINE_CHARS).toBe(40);
    const long = 'a-very-long-event-name-from-a-library-plugin';
    const slow: Record<number, number> = {};
    const events: Record<number, string[]> = {};
    for (let i = 0; i < 10; i++) {
      slow[50 * i + 20] = 1500;
      events[50 * i + 20] = [long, `${long}-2`, `${long}-3`];
    }
    for (const label of [
      '',
      'x',
      'a label far longer than a phone line is wide',
    ]) {
      const text = formatFrameRunSummary(
        label,
        summaryOf(600, slow, events, 1000 / 120)
      );
      for (const line of text.split('\n')) {
        expect(line.length).toBeLessThanOrEqual(SUMMARY_MAX_LINE_CHARS);
      }
    }
  });
});

describe('buildFrameExport', () => {
  const device = {
    userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/129 Mobile',
    dpr: 2.75,
    relief: true,
    gpu: null,
  };

  it('is valid JSON with the schema, device, target and one entry per run', () => {
    const json = JSON.stringify(
      buildFrameExport({
        device,
        runs: [
          { label: 'alps 1/3', summary: summaryOf(300) },
          { label: 'ocean 1/3', summary: hitchyRun() },
        ],
      })
    );
    const parsed = JSON.parse(json) as FrameExport;
    expect(parsed.schema).toBe(FRAME_EXPORT_SCHEMA);
    expect(parsed.device).toEqual(device);
    expect(parsed.target).toEqual({
      hardMs: 50,
      softMs: 33,
      softAllowed: 5,
      handfuls: [3, 5, 10],
    });
    expect(parsed.runs).toHaveLength(2);
    expect(parsed.runs[0]!.pass).toBe(true);
    expect(parsed.runs[1]!.pass).toBe(false);
    expect(parsed.runs[1]!.over).toEqual({ 33: 10, 50: 10, 100: 10 });
    expect(parsed.runs[1]!.handfuls).toEqual({ 3: false, 5: false, 10: false });
  });

  // JSON has no NaN or Infinity: stringify would turn them into null and
  // lose the difference between "never in a normal frame" and "undefined".
  it('writes an infinite ratio as "inf" and an empty run without NaN', () => {
    const e = buildFrameExport({
      device: { bad: Number.NaN },
      runs: [
        { label: 'empty', summary: createFrameRun().summary() },
        { label: 'hitchy', summary: hitchyRun() },
      ],
    });
    const json = JSON.stringify(e);
    expect(json).not.toMatch(/NaN|Infinity/);
    expect(e.device).toEqual({ bad: null });
    expect(e.runs[0]!.ms.p50).toBeNull();
    const step = e.runs[1]!.causes.find((c) => c.kind === 'e-step')!;
    expect(step.maxRatio).toBe('inf');
  });

  it('carries the raw join counts so a verdict can be recomputed', () => {
    const e = buildFrameExport({
      device,
      runs: [{ label: 'hitchy', summary: hitchyRun() }],
    });
    const run = e.runs[0]!;
    expect(run.frames).toBe(2000);
    expect(run.lags).toEqual([0, 1, 2]);
    // `over` doubles as the join's hitch-frame counts.
    expect(run.over).toEqual({ 33: 10, 50: 10, 100: 10 });
    const step = run.causes.find((c) => c.kind === 'e-step')!;
    // [threshold][lag] = [inHitch, inNormal]: the step is in every hitch
    // frame, and in the normal frames after it at lag 1 and 2.
    expect(step.counts[0]).toEqual([
      [10, 0],
      [10, 10],
      [10, 20],
    ]);
    expect(step.status).toBe('supported');
    expect(step.cells).toBe('27/27');
  });

  // A run that meets the target has few hitch frames; a cause short of the
  // minimum in each run can reach it pooled. The pool carries every kind,
  // a run only its supported or provisional ones.
  it('pools the join over all runs, with every event kind', () => {
    const threeHitches = () =>
      summaryOf(
        600,
        { 100: 120, 300: 120, 500: 120 },
        { 100: ['gc'], 300: ['gc'], 500: ['gc'], 7: ['tick'] }
      );
    const e = buildFrameExport({
      device,
      runs: [
        { label: 'a', summary: threeHitches() },
        { label: 'b', summary: threeHitches() },
      ],
    });
    expect(e.runs[0]!.causes).toEqual([]);
    expect(e.pooled!.runs).toBe(2);
    expect(e.pooled!.frames).toBe(1200);
    expect(e.pooled!.hitchFrames).toEqual({ 33: 6, 50: 6, 100: 6 });
    const gc = e.pooled!.causes.find((c) => c.kind === 'gc')!;
    expect(gc.status).toBe('supported');
    expect(e.pooled!.causes.map((c) => c.kind).sort()).toEqual(['gc', 'tick']);
    expect(buildFrameExport({ device, runs: [] }).pooled).toBeNull();
  });

  it('keeps the worst frames across runs, slowest first, with their run', () => {
    const e = buildFrameExport({
      device,
      runs: [
        { label: 'a', summary: summaryOf(100, { 5: 60 }, { 5: ['x'] }) },
        { label: 'b', summary: summaryOf(100, { 7: 90, 8: 45 }) },
      ],
      worstCount: 2,
    });
    expect(e.worst).toEqual([
      { run: 1, frame: 7, ms: 90, events: [] },
      { run: 0, frame: 5, ms: 60, events: ['x'] },
    ]);
  });

  it('truncates very long device strings', () => {
    const e = buildFrameExport({ device: { ua: 'x'.repeat(5000) }, runs: [] });
    expect((e.device['ua'] as string).length).toBeLessThanOrEqual(500);
  });

  // The plan's paste budget (§4.1: about 5-10 KB): a quick sweep is 12
  // runs; each with eight event kinds and the 20 worst frames overall.
  it('fits a quick sweep of 12 runs in 10 KB', () => {
    const kinds = [
      'e-step',
      'load-model:relief',
      'load-model:globe',
      'dispose-model:relief',
      'program',
      'band-edge',
      'release',
      'raycast-burst',
    ];
    const runs = Array.from({ length: 12 }, (_, run) => {
      const slow: Record<number, number> = {};
      const events: Record<number, string[]> = {};
      for (let i = 0; i < 1400; i++) {
        if (i % 97 === run) slow[i] = 40 + ((i * 7) % 90);
        if (i % 13 === 0) events[i] = [kinds[i % 8]!, kinds[(i + run) % 8]!];
      }
      return {
        label: `place${run % 4} ${1 + (run >> 2)}/3`,
        summary: summaryOf(1400, slow, events, 1000 / 120),
      };
    });
    const json = JSON.stringify(
      buildFrameExport({
        device: {
          userAgent:
            'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
          gpuVendor: 'Qualcomm',
          gpuRenderer: 'Adreno (TM) 740',
          dpr: 2.625,
          viewport: '412x915',
          drawingBuffer: '824x1830',
          relief: true,
          hash: '#perf=1&perfSweep=quick&relief=1',
          parallelShaderCompile: true,
          floatLinear: true,
          deviceMemory: 8,
          hardwareConcurrency: 8,
          build: 'r767 0123abcd',
          refreshIntervalMs: 8.33,
        },
        runs,
      })
    );
    expect(json.length).toBeLessThanOrEqual(10_000);
  });
});
