/**
 * The worker spike's measuring half (throwaway, deleted with the worker
 * queue): one cell of methods on the synthetic pair, run the same way on
 * the main thread and in the spike's worker, through the shipped
 * `buildMethods` and `runBenchmark` unchanged; plus the PNG round trip.
 *
 * @see worker-spike-cells.ts.md
 */
import { lowerMedian } from "gps-plus-slam-app-framework/utils/median";

import { pickName } from "./aliked-io";
import { buildMethods, type Backend } from "./bench-methods";
import { errorText, fetchBytes, lookupIn, type LoadDeps } from "./bench-net";
import { runBenchmark, type RunContext } from "./bench-run";
import { syntheticPair } from "./bench-synthetic";
import { clsVector, DINO_CROP, dinoInput, floatValues } from "./dino-io";
import type { Frame } from "./bench-image";
import { loadOrtRuntime, ortWasmThreads } from "./method-aliked";
import { DINO_MODELS } from "./method-dino";

/** The queue's frame: a camera frame of this size, measured at the sizes. */
export const SPIKE_FRAME = { width: 1280, height: 720 } as const;
/** The page's default long edges, which the queue keeps. */
const SPIKE_SIZES: readonly number[] = [320, 480, 640];

export type SpikeMethod = "sift" | "xfeat" | "aliked" | "siftlg" | "dino";

export interface CellRequest {
  readonly backend: Backend;
  readonly methods: readonly SpikeMethod[];
  readonly runs: number;
  readonly warmup: boolean;
  /** The synthetic pair's seed: a second pair is a different seed. */
  readonly seed: number;
}

interface SizeNumbers {
  readonly longEdge: number;
  readonly keypoints: number;
  readonly matches: number;
  readonly extractMs: number;
  readonly matchMs: number;
  readonly error: string | null;
}

interface MethodNumbers {
  readonly id: string;
  readonly backend: string;
  readonly initMs: number;
  /** Per download: from the HTTP cache (true), fetched (false), unknown. */
  readonly cached: readonly (boolean | null)[];
  readonly downloadMs: number;
  readonly notes: readonly string[];
  readonly sizes: readonly SizeNumbers[];
  readonly error: string | null;
}

interface DinoNumbers {
  readonly backend: Backend;
  readonly initMs: number;
  readonly forwardMs: number;
  readonly cached: boolean | null;
  /** The CLS embedding of frame A; null when the arm failed. */
  readonly embedding: readonly number[] | null;
  readonly error: string | null;
}

export interface CellResult {
  readonly methods: readonly MethodNumbers[];
  readonly dino: DinoNumbers | null;
  readonly ms: number;
}

/** The browser's loaders, valid on the main thread and in a worker. */
const spikeDeps: LoadDeps = {
  importModule: (url) => import(/* @vite-ignore */ url) as Promise<unknown>,
  fetch: (url, init) => fetch(url, init),
  now: () => performance.now(),
  resources: () =>
    performance.getEntriesByType("resource") as PerformanceResourceTiming[],
};

/** What this context offers: a WebGPU adapter, and the WASM thread line. */
export async function contextFacts(): Promise<{
  webgpu: string;
  threads: string;
}> {
  const isolated = globalThis.crossOriginIsolated === true;
  const n = ortWasmThreads(isolated, globalThis.navigator?.hardwareConcurrency);
  const threads = `${isolated ? "isolated" : "not isolated"}: ${String(n)} thread${n === 1 ? "" : "s"}`;
  const gpu = (
    globalThis.navigator as {
      gpu?: { requestAdapter(): Promise<unknown> };
    }
  ).gpu;
  if (!gpu) {
    return { webgpu: "none (no navigator.gpu)", threads };
  }
  try {
    const adapter = await gpu.requestAdapter();
    return { webgpu: adapter ? "adapter" : "none (no adapter)", threads };
  } catch (e) {
    return { webgpu: `none (${errorText(e)})`, threads };
  }
}

/** Runs one cell's methods on the synthetic pair of `seed`. */
export async function runCell(
  req: CellRequest,
  context: RunContext,
  log: (line: string) => void,
  deps: LoadDeps = spikeDeps,
): Promise<CellResult> {
  const t0 = deps.now();
  const { a, b } = syntheticPair(
    SPIKE_FRAME.width,
    SPIKE_FRAME.height,
    req.seed,
  );
  const has = (m: SpikeMethod) => req.methods.includes(m);
  const methods = buildMethods(
    {
      sift: has("sift"),
      xfeat: has("xfeat"),
      aliked: has("aliked"),
      siftLightGlue: has("siftlg"),
      backends: [req.backend],
      precisions: ["fp16"],
    },
    deps,
    context,
  );
  const results = await runBenchmark(
    methods,
    { a, b, warp: null },
    { sizes: SPIKE_SIZES, runs: req.runs, warmup: req.warmup },
    {
      now: deps.now,
      yieldToUi: () => new Promise((r) => setTimeout(r, 0)),
      log,
    },
  );
  const numbers: MethodNumbers[] = results.map((r) => ({
    id: r.id,
    backend: r.backend,
    initMs: r.initMs,
    cached: r.downloads.map((d) => d.cached),
    downloadMs: r.downloads.reduce((s, d) => s + d.ms, 0),
    notes: r.notes,
    sizes: r.sizes.map((s) => ({
      longEdge: s.longEdge,
      keypoints: s.keypoints,
      matches: s.matches,
      extractMs: s.extract.median,
      matchMs: s.match.median,
      error: s.error,
    })),
    error: r.error,
  }));
  const dino = has("dino")
    ? await dinoEmbedding(req.backend, a, req.warmup ? req.runs + 1 : 1, deps)
    : null;
  return { methods: numbers, dino, ms: deps.now() - t0 };
}

/**
 * DINOv2 int8's CLS embedding of `frame`, forwarded `passes` times (the
 * last one kept; the median pass time reported). The speed test's arm
 * reports only the A-B cosine, so the spike reads the embedding itself.
 */
async function dinoEmbedding(
  backend: Backend,
  frame: Frame,
  passes: number,
  deps: LoadDeps,
): Promise<DinoNumbers> {
  const failed = (e: unknown): DinoNumbers => ({
    backend,
    initMs: NaN,
    forwardMs: NaN,
    cached: null,
    embedding: null,
    error: errorText(e),
  });
  try {
    const ort = await loadOrtRuntime(deps);
    const net = { fetch: deps.fetch, now: deps.now, lookup: lookupIn(deps) };
    const file = await fetchBytes(DINO_MODELS.int8.url, "DINOv2 int8", net);
    const t0 = deps.now();
    const session = await ort.InferenceSession.create(file.bytes, {
      executionProviders: [backend],
    });
    const initMs = deps.now() - t0;
    try {
      const input = new ort.Tensor("float32", dinoInput(frame), [
        1,
        3,
        DINO_CROP,
        DINO_CROP,
      ]);
      const inName = pickName(session.inputNames, "pixel_values", 0);
      const outName = pickName(session.outputNames, "last_hidden_state", 0);
      const times: number[] = [];
      let embedding: Float32Array | null = null;
      for (let i = 0; i < passes; i++) {
        const t1 = deps.now();
        const out = await session.run({ [inName]: input });
        times.push(deps.now() - t1);
        const o = out[outName];
        if (!o) {
          throw new Error(`DINOv2: no ${outName} output`);
        }
        embedding = clsVector(floatValues(o.data), o.dims);
      }
      return {
        backend,
        initMs,
        forwardMs: lowerMedian(times),
        cached: file.record.cached,
        embedding: embedding ? Array.from(embedding) : null,
        error: null,
      };
    } finally {
      await session.release().catch(() => undefined);
    }
  } catch (e) {
    return failed(e);
  }
}

/**
 * Decodes a PNG the way the queue's worker will (`createImageBitmap`, no
 * premultiply, no colour conversion, into an `OffscreenCanvas`) and counts
 * the bytes that differ from `rgba`.
 */
export async function pngRoundTrip(
  png: Blob,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<{ ms: number; differing: number }> {
  const t0 = performance.now();
  const bitmap = await createImageBitmap(png, {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("no 2d context on an OffscreenCanvas");
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const back = ctx.getImageData(0, 0, width, height).data;
  const ms = performance.now() - t0;
  let differing =
    back.length === rgba.length ? 0 : Math.abs(back.length - rgba.length);
  const n = Math.min(back.length, rgba.length);
  for (let i = 0; i < n; i++) {
    if (back[i] !== rgba[i]) {
      differing++;
    }
  }
  return { ms, differing };
}
