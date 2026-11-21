/**
 * The feature matching benchmark's run loop: every method, every size, one
 * warm-up and N timed runs, each failure caught and kept as a line.
 *
 * @see bench-run.ts.md
 */
import { lowerMedian } from "gps-plus-slam-app-framework/utils/median";

import { resizeFrame, sizeForLongEdge, type Frame } from "./bench-image";
import { errorText, type DownloadRecord } from "./bench-net";
import { summarize, type Summary } from "./bench-stats";
import { countCorrect, type Warp } from "./bench-synthetic";

/** A match on the synthetic pair is correct within this many pixels. */
export const CORRECT_TOL_PX = 3;

/** One frame's features; positions in the pixels of the frame given. */
export interface Features {
  readonly count: number;
  readonly descriptorBytes: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** The method's own data (descriptors, tensors); opaque to the loop. */
  readonly payload: unknown;
}

/** A method, loaded and ready to time. */
export interface MethodRunner {
  /** The backend actually in use, as the runtime reports it. */
  readonly backend: string;
  readonly downloads: readonly DownloadRecord[];
  readonly initMs: number;
  readonly notes: readonly string[];
  extract(frame: Frame): Promise<Features>;
  /** Matched pairs, flat `[ia, ib, ...]`. */
  match(a: Features, b: Features): Promise<Int32Array>;
  dispose(): void;
}

/** A method to run: its name and how to load it. */
export interface BenchMethod {
  readonly id: string;
  readonly label: string;
  init(): Promise<MethodRunner>;
}

export interface BenchInput {
  readonly a: Frame;
  readonly b: Frame;
  /** The known warp from A to B (synthetic pair), null for camera frames. */
  readonly warp: Warp | null;
}

/** Keypoint positions of one frame, in the pixels of the size computed. */
export interface Points {
  readonly x: Float32Array;
  readonly y: Float32Array;
}

/**
 * One timed round's output at a size: both frames' keypoints and the
 * matched pairs (flat `[ia, ib, ...]`), for drawing and saving.
 */
export interface SizeSample {
  readonly a: Points;
  readonly b: Points;
  readonly pairs: Int32Array;
}

export interface SizeResult {
  readonly longEdge: number;
  readonly width: number;
  readonly height: number;
  readonly extract: Summary;
  readonly match: Summary;
  readonly keypoints: number;
  readonly descriptorBytes: number;
  readonly matches: number;
  readonly correct: number | null;
  /** The last timed round's keypoints and matches; null when the size failed. */
  readonly sample: SizeSample | null;
  readonly error: string | null;
}

export interface MethodResult {
  readonly id: string;
  readonly label: string;
  readonly backend: string;
  readonly downloads: readonly DownloadRecord[];
  readonly initMs: number;
  readonly notes: readonly string[];
  readonly sizes: readonly SizeResult[];
  readonly error: string | null;
}

export interface BenchHooks {
  readonly now: () => number;
  /** Lets the page paint between runs. */
  readonly yieldToUi: () => Promise<void>;
  readonly log: (line: string) => void;
  /** Called as each method's size finishes (also a failed one). */
  readonly onSize?: (
    method: { readonly id: string; readonly label: string },
    size: SizeResult,
  ) => void;
}

/**
 * Runs every method on the pair at every long edge: per size one warm-up
 * (extract A, extract B, match; unless `warmup` is false) and then `runs`
 * timed rounds. Extraction is
 * timed per frame (2 x runs samples), matching per pair. A method that fails
 * to load, or a size that fails, is kept with its error; the loop goes on
 * and every loaded method is disposed.
 */
export async function runBenchmark(
  methods: readonly BenchMethod[],
  input: BenchInput,
  options: {
    readonly sizes: readonly number[];
    readonly runs: number;
    /** Default true; false skips the warm-up round. */
    readonly warmup?: boolean;
  },
  hooks: BenchHooks,
): Promise<MethodResult[]> {
  const runs = Math.max(1, Math.floor(options.runs));
  const results: MethodResult[] = [];
  for (const method of methods) {
    hooks.log(`${method.label}: loading`);
    let runner: MethodRunner;
    try {
      runner = await method.init();
    } catch (e) {
      const error = `init: ${errorText(e)}`;
      hooks.log(`ERROR ${method.label}: ${error}`);
      results.push(emptyResult(method, error));
      continue;
    }
    hooks.log(
      `${method.label}: ready on ${runner.backend} in ${runner.initMs.toFixed(0)} ms`,
    );
    const sizes: SizeResult[] = [];
    try {
      for (const longEdge of options.sizes) {
        const size = await runSize(
          runner,
          method.label,
          input,
          longEdge,
          runs,
          options.warmup ?? true,
          hooks,
        );
        sizes.push(size);
        hooks.onSize?.(method, size);
      }
    } finally {
      runner.dispose();
    }
    results.push({
      id: method.id,
      label: method.label,
      backend: runner.backend,
      downloads: runner.downloads,
      initMs: runner.initMs,
      notes: runner.notes,
      sizes,
      error: null,
    });
  }
  return results;
}

function emptyResult(method: BenchMethod, error: string): MethodResult {
  return {
    id: method.id,
    label: method.label,
    backend: "-",
    downloads: [],
    initMs: NaN,
    notes: [],
    sizes: [],
    error,
  };
}

async function runSize(
  runner: MethodRunner,
  label: string,
  input: BenchInput,
  longEdge: number,
  runs: number,
  warmup: boolean,
  hooks: BenchHooks,
): Promise<SizeResult> {
  let width = 0;
  let height = 0;
  const extractMs: number[] = [];
  const matchMs: number[] = [];
  const keypoints: number[] = [];
  const bytes: number[] = [];
  const matches: number[] = [];
  const correct: number[] = [];
  let sample: SizeSample | null = null;
  let error: string | null = null;
  try {
    ({ width, height } = sizeForLongEdge(
      input.a.width,
      input.a.height,
      longEdge,
    ));
    const fa = resizeFrame(input.a, width, height);
    const fb = resizeFrame(input.b, width, height);
    if (warmup) {
      await runner.match(await runner.extract(fa), await runner.extract(fb));
      await hooks.yieldToUi();
    }
    for (let r = 0; r < runs; r++) {
      const t0 = hooks.now();
      const ea = await runner.extract(fa);
      const t1 = hooks.now();
      const eb = await runner.extract(fb);
      const t2 = hooks.now();
      const pairs = await runner.match(ea, eb);
      const t3 = hooks.now();
      extractMs.push(t1 - t0, t2 - t1);
      matchMs.push(t3 - t2);
      keypoints.push(ea.count, eb.count);
      bytes.push(ea.descriptorBytes, eb.descriptorBytes);
      matches.push(pairs.length / 2);
      // Copied, like the points: a method may reuse its buffers.
      sample = { a: pointsOf(ea), b: pointsOf(eb), pairs: pairs.slice() };
      if (input.warp) {
        correct.push(
          countCorrect(
            pairs,
            ea,
            eb,
            input.warp,
            width,
            height,
            CORRECT_TOL_PX,
          ),
        );
      }
      await hooks.yieldToUi();
    }
    hooks.log(`${label} @${String(longEdge)}: done`);
  } catch (e) {
    error = errorText(e);
    sample = null;
    hooks.log(`ERROR ${label} @${String(longEdge)}: ${error}`);
  }
  return {
    longEdge,
    width,
    height,
    extract: summarize(extractMs),
    match: summarize(matchMs),
    keypoints: lowerMedian(keypoints),
    descriptorBytes: lowerMedian(bytes),
    matches: lowerMedian(matches),
    correct: input.warp ? lowerMedian(correct) : null,
    sample,
    error,
  };
}

/** Positions copied out of a method's features (its arrays may be reused). */
const pointsOf = (f: Features): Points => ({
  x: f.x.slice(0, f.count),
  y: f.y.slice(0, f.count),
});
