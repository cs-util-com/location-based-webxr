/**
 * Why this test matters (frame-hitch plan 2026-10-03-2017 §4.4, §4.3): the
 * owner runs the sweep once on a phone and pastes one export, so the cell
 * list must be exactly the plan's: `quick` the four places at the default
 * speed, three repeats each, and its first cell again at the end (the heat
 * check, §4.1); `full` adds the Alps varied ONE factor at a time around the
 * defaults, three repeats each. The time estimate shown before Run must
 * follow from the same list, so it cannot drift from what runs.
 */
import { describe, expect, it } from "vitest";

import { PERF_PLACES, perfZoomDurationMs } from "./globe-perf-path.js";
import {
  PERF_DEFAULT_CELL,
  perfOverheadVerdict,
  perfSweepCells,
  perfSweepEstimateMs,
} from "./globe-perf-sweep.js";

const FACTORS = [
  "decadesPerS",
  "adjustHeight",
  "reliefCacheMiB",
  "parseJobs",
  "downloadsPerOrigin",
  "pixelRatio",
] as const;

const differing = (a: object, b: object) =>
  FACTORS.filter(
    (f) =>
      (a as Record<string, unknown>)[f] !== (b as Record<string, unknown>)[f],
  );

describe("perfSweepCells", () => {
  it("quick: the four places, three repeats each, one zoom through the controls, then the first cell again", () => {
    const cells = perfSweepCells("quick");
    expect(cells.length).toBe(14);
    expect(cells.slice(0, 12).map((c) => c.place)).toEqual(
      PERF_PLACES.flatMap((p) => [p.id, p.id, p.id]),
    );
    expect(cells.slice(0, 12).map((c) => c.repeat)).toEqual([
      1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3,
    ]);
    for (const c of cells) expect(differing(c, PERF_DEFAULT_CELL)).toEqual([]);
    // Why (§4.2, H5): one run at the Alps zooms through the controls' own
    // wheel input, so the export shows the zoom-point raycasts a pinch
    // costs; every other cell places the camera, so runs compare.
    expect(cells.map((c) => c.drive)).toEqual([
      ...Array(12).fill("place"),
      "controls",
      "place",
    ]);
    expect(cells[12]!.place).toBe("alps");
    expect(cells[13]!.place).toBe(cells[0]!.place);
    expect(cells[13]!.heatCheck).toBe(true);
    expect(cells.slice(0, 13).every((c) => !c.heatCheck)).toBe(true);
  });

  it("full: quick plus the Alps varied one factor at a time, three repeats each", () => {
    const quick = perfSweepCells("quick");
    const full = perfSweepCells("full");
    expect(full.slice(0, 13)).toEqual(quick.slice(0, 13));
    const extra = full.slice(13, -1);
    expect(extra.every((c) => c.drive === "place")).toBe(true);
    expect(extra.every((c) => c.place === "alps")).toBe(true);
    const variants = new Map<string, number>();
    for (const c of extra) {
      const d = differing(c, PERF_DEFAULT_CELL);
      expect(d.length).toBe(1);
      const key = `${d[0]}=${String(c[d[0]!])}`;
      variants.set(key, (variants.get(key) ?? 0) + 1);
    }
    expect([...variants.keys()].sort()).toEqual(
      [
        "decadesPerS=0.25",
        "decadesPerS=1",
        "adjustHeight=0",
        "reliefCacheMiB=32",
        "parseJobs=1",
        "parseJobs=2",
        "downloadsPerOrigin=6",
        "downloadsPerOrigin=12",
        "pixelRatio=1",
      ].sort(),
    );
    for (const n of variants.values()) expect(n).toBe(3);
    expect(full[full.length - 1]!.heatCheck).toBe(true);
    // The full sweep is split in two halves with a pause (heat).
    expect(full.filter((c) => c.pauseBefore).length).toBe(1);
  });

  it("quick and full record every event; overhead alternates the recorder off and on", () => {
    for (const c of [...perfSweepCells("quick"), ...perfSweepCells("full")]) {
      expect(c.hooks).toBe(true);
    }
    // Why (§4.1, its own cost): three runs with the recorder's hooks off
    // against three with them on, in one page load, at one place and the
    // defaults; alternating, so a phone warming over the six runs weighs
    // on both kinds alike.
    const overhead = perfSweepCells("overhead");
    expect(overhead.map((c) => c.hooks)).toEqual([
      false,
      true,
      false,
      true,
      false,
      true,
    ]);
    expect(overhead.every((c) => c.place === "alps")).toBe(true);
    expect(overhead.every((c) => c.drive === "place")).toBe(true);
    for (const c of overhead)
      expect(differing(c, PERF_DEFAULT_CELL)).toEqual([]);
    expect(overhead.some((c) => c.heatCheck || c.pauseBefore)).toBe(false);
  });

  it("refuses an unknown sweep", () => {
    expect(() => perfSweepCells("everything" as "quick")).toThrow(RangeError);
  });
});

describe("perfSweepEstimateMs", () => {
  it("is the calibration, every cell's zoom, and the moves between places", () => {
    const quick = perfSweepCells("quick");
    const zoom = quick.reduce(
      (s, c) => s + perfZoomDurationMs({ decadesPerS: c.decadesPerS }),
      0,
    );
    const estimate = perfSweepEstimateMs(quick);
    expect(estimate).toBeGreaterThan(zoom);
    // The plan's "about 5 min" for quick.
    expect(estimate / 60_000).toBeGreaterThan(3.5);
    expect(estimate / 60_000).toBeLessThan(6.5);
    // The full sweep. The plan's "about 25 min" assumed 12-45 s runs; by
    // its own law (5.6 decades at 0.5 a second plus 2 s at each end) a run
    // is 15.3 s, so the full sweep is about 11 min of runs and moves.
    const full = perfSweepEstimateMs(perfSweepCells("full"));
    expect(full / 60_000).toBeGreaterThan(9);
    expect(full / 60_000).toBeLessThan(35);
  });
});

// Why this matters (§4.1): the recorder's numbers are used only if its own
// cost stays inside the run-to-run noise: the on-off difference of the
// mean p50 and p95 within the spread (max - min) of the off runs. A fixed
// percentage (revision 0's 2 %) sat below the likely noise.
describe("perfOverheadVerdict", () => {
  const run = (hooks: boolean, p50Ms: number, p95Ms: number) => ({
    hooks,
    p50Ms,
    p95Ms,
  });

  it("passes when the on runs stay inside the off runs' spread", () => {
    const v = perfOverheadVerdict([
      run(false, 16, 20),
      run(true, 16.5, 21),
      run(false, 17, 22),
      run(true, 16.8, 21.5),
      run(false, 16.4, 21),
      run(true, 16.6, 21.2),
    ])!;
    expect(v.offSpread.p50).toBeCloseTo(1, 9);
    expect(v.offSpread.p95).toBeCloseTo(2, 9);
    expect(v.diff.p50).toBeCloseTo(16.6333333 - 16.4666667, 5);
    expect(v.pass).toBe(true);
    // The bound swept: p95's difference (0.233) is inside half the spread
    // (1), p50's (0.167) inside half of 1 too.
    expect(v.passAt).toEqual({ "0.5": true, "1": true, "2": true });
  });

  it("fails when either difference exceeds its spread", () => {
    const v = perfOverheadVerdict([
      run(false, 16, 20),
      run(false, 16.2, 20.2),
      run(true, 16.1, 23),
      run(true, 16.1, 23),
    ])!;
    expect(v.pass).toBe(false);
    expect(v.passAt).toEqual({ "0.5": false, "1": false, "2": false });
    // p95 is 2.9 over a 0.2 spread; p50 0.0 over 0.2. Only a much wider
    // bound would pass it, so the verdict holds over the swept range.
    const near = perfOverheadVerdict([
      run(false, 16, 20),
      run(false, 16.2, 21),
      run(true, 16.1, 21.2),
      run(true, 16.1, 21.6),
    ])!;
    // p95 diff 0.9 against a spread of 1: inside at x1 and x2, not at x0.5.
    expect(near.passAt).toEqual({ "0.5": false, "1": true, "2": true });
  });

  it("is null without two runs of each kind, and skips missing percentiles", () => {
    expect(perfOverheadVerdict([run(false, 16, 20), run(true, 16, 20)])).toBe(
      null,
    );
    expect(
      perfOverheadVerdict([
        run(false, 16, 20),
        { hooks: false, p50Ms: null, p95Ms: null },
        run(true, 16, 20),
        run(true, 16, 20),
      ]),
    ).toBe(null);
  });
});
