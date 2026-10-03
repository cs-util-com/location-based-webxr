/**
 * The frame-hitch recorder's in-page sweep (globe zoom frame-hitch plan
 * 2026-10-03-2017 §4.4, §4.3): the cell list of `quick` and `full` and the
 * time estimate shown before Run. Pure.
 *
 * @see globe-perf-sweep.ts.md
 */
import { PERF_PLACES, perfZoomDurationMs } from "./globe-perf-path.js";

/** What a cell may vary (§4.3), one at a time around the defaults. */
export interface PerfFactors {
  readonly decadesPerS: number;
  /** The controls' height adjustment (H5): 1 on, 0 off. */
  readonly adjustHeight: 0 | 1;
  readonly reliefCacheMiB: number;
  readonly parseJobs: number;
  readonly downloadsPerOrigin: number;
  readonly pixelRatio: number;
}

/** One run of the sweep: where, how, and which repeat. */
export interface PerfCell extends PerfFactors {
  readonly place: string;
  readonly repeat: number;
  /** The sweep's first cell run again at the end (§4.1, heat). */
  readonly heatCheck: boolean;
  /** The full sweep pauses before this cell (two halves, against heat). */
  readonly pauseBefore: boolean;
  /**
   * The recorder's event hooks on (true) or off (frame intervals only):
   * off only in the `overhead` sweep, which measures the hooks' own cost.
   */
  readonly hooks: boolean;
  /**
   * How the zoom is driven (§4.2): `place` sets the camera on the path
   * each frame (runs compare); `controls` feeds the controls' own wheel
   * input on the same altitude law, so the zoom-point raycasts a pinch or
   * a wheel costs (H5) are counted too.
   */
  readonly drive: "place" | "controls";
}

/** A sweep's name: the plan's two, and the recorder's own cost (§4.1). */
export type PerfSweep = "quick" | "full" | "overhead";

/** The defaults every cell varies around (one factor at a time, §4.3). */
export const PERF_DEFAULT_CELL: PerfFactors = Object.freeze({
  decadesPerS: 0.5,
  adjustHeight: 1,
  reliefCacheMiB: 64,
  parseJobs: 5,
  downloadsPerOrigin: 25,
  pixelRatio: 2,
});

/** Repeats per cell (§4.3). */
const REPEATS = 3;

/** The Alps' one-factor variants of `full` (§4.4). */
const FULL_VARIANTS: readonly Partial<PerfFactors>[] = [
  { decadesPerS: 0.25 },
  { decadesPerS: 1 },
  { adjustHeight: 0 },
  { reliefCacheMiB: 32 },
  { parseJobs: 1 },
  { parseJobs: 2 },
  { downloadsPerOrigin: 6 },
  { downloadsPerOrigin: 12 },
  { pixelRatio: 1 },
];

/** Moving the camera to a new place and letting it settle (ms). */
const MOVE_MS = 8_000;
/** The idle calibration before the first run (§4.1). */
const CALIBRATION_MS = 2_000;

const cell = (
  place: string,
  repeat: number,
  variant: Partial<PerfFactors> = {},
): PerfCell => ({
  place,
  ...PERF_DEFAULT_CELL,
  ...variant,
  repeat,
  heatCheck: false,
  pauseBefore: false,
  hooks: true,
  drive: "place",
});

/** The overhead sweep: the Alps, hooks off and on alternating (off first). */
const overheadCells = (): PerfCell[] =>
  Array.from({ length: 2 * REPEATS }, (_, i) => ({
    ...cell("alps", Math.floor(i / 2) + 1),
    hooks: i % 2 === 1,
  }));

/** `full`'s Alps variants, three repeats each; the first pauses (heat). */
const variantCells = (): PerfCell[] =>
  FULL_VARIANTS.flatMap((variant, v) =>
    Array.from({ length: REPEATS }, (_, r) => ({
      ...cell("alps", r + 1, variant),
      pauseBefore: v === 0 && r === 0,
    })),
  );

/**
 * The cells of a sweep, in run order. `quick`: the four places at the
 * defaults, three repeats each, one zoom at the Alps driven through the
 * controls, then the first cell again (the heat check). `full`: `quick`'s
 * thirteen, then (after a pause) the Alps varied
 * one factor at a time, three repeats each, then the first cell again.
 * `overhead` (§4.1, the recorder's own cost): the Alps at the defaults,
 * six runs alternating the hooks off and on, so heat weighs on both kinds
 * alike. RangeError for another name.
 */
export function perfSweepCells(sweep: PerfSweep): PerfCell[] {
  if (sweep !== "quick" && sweep !== "full" && sweep !== "overhead") {
    throw new RangeError(
      `a sweep is quick, full or overhead, got ${String(sweep)}`,
    );
  }
  if (sweep === "overhead") return overheadCells();
  const cells: PerfCell[] = PERF_PLACES.flatMap((p) =>
    Array.from({ length: REPEATS }, (_, r) => cell(p.id, r + 1)),
  );
  cells.push({ ...cell("alps", 1), drive: "controls" });
  if (sweep === "full") cells.push(...variantCells());
  cells.push({
    ...cells[0]!,
    repeat: REPEATS + 1,
    heatCheck: true,
    pauseBefore: false,
  });
  return cells;
}

/**
 * The sweep's estimated length (ms): the idle calibration, each cell's
 * zoom at its speed, and a move whenever the place changes.
 */
export function perfSweepEstimateMs(cells: readonly PerfCell[]): number {
  let ms = CALIBRATION_MS;
  let place: string | null = null;
  for (const c of cells) {
    if (c.place !== place) ms += MOVE_MS;
    place = c.place;
    ms += perfZoomDurationMs({ decadesPerS: c.decadesPerS });
  }
  return ms;
}

/** One run's percentiles for the overhead check (ms; null when it had none). */
export interface PerfOverheadRun {
  readonly hooks: boolean;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
}

/**
 * The recorder's own cost (§4.1): the mean p50 and p95 of the runs with
 * the hooks on minus those with them off, against the spread (max - min)
 * of the off runs, the noise floor. `pass` when both differences stay
 * within their spreads; `passAt` the same with the spread scaled by 0.5,
 * 1 and 2 (the bound swept, owner rule 2026-09-13). Null without two usable runs of each kind (a run
 * whose percentiles are null is not usable).
 */
export function perfOverheadVerdict(runs: readonly PerfOverheadRun[]): {
  offSpread: { p50: number; p95: number };
  diff: { p50: number; p95: number };
  pass: boolean;
  passAt: Readonly<Record<"0.5" | "1" | "2", boolean>>;
} | null {
  const usable = runs.filter(
    (r) => Number.isFinite(r.p50Ms) && Number.isFinite(r.p95Ms),
  ) as { hooks: boolean; p50Ms: number; p95Ms: number }[];
  const off = usable.filter((r) => !r.hooks);
  const on = usable.filter((r) => r.hooks);
  if (off.length < 2 || on.length < 2) return null;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
  const offSpread = {
    p50: spread(off.map((r) => r.p50Ms)),
    p95: spread(off.map((r) => r.p95Ms)),
  };
  const diff = {
    p50: mean(on.map((r) => r.p50Ms)) - mean(off.map((r) => r.p50Ms)),
    p95: mean(on.map((r) => r.p95Ms)) - mean(off.map((r) => r.p95Ms)),
  };
  const within = (scale: number) =>
    diff.p50 <= scale * offSpread.p50 && diff.p95 <= scale * offSpread.p95;
  return {
    offSpread,
    diff,
    pass: within(1),
    passAt: { "0.5": within(0.5), "1": within(1), "2": within(2) },
  };
}
