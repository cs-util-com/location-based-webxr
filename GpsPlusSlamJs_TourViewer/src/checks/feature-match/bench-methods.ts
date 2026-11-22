/**
 * The benchmark's method list from the page's choices: which methods,
 * which backends, which XFeat weight precisions.
 *
 * @see bench-methods.ts.md
 */
import type { LoadDeps } from "./bench-net";
import type { BenchMethod } from "./bench-run";
import { alikedMethod } from "./method-aliked";
import { siftMethod } from "./method-sift";
import { xfeatMethod, type XFeatPrecision } from "./method-xfeat";

export type Backend = "webgpu" | "wasm";

export interface MethodSelection {
  readonly sift: boolean;
  readonly xfeat: boolean;
  readonly aliked: boolean;
  readonly backends: readonly Backend[];
  readonly precisions: readonly XFeatPrecision[];
}

/**
 * One method per (method, backend[, precision]) chosen, cheapest first so
 * a slow download does not hold up the quick numbers. SIFT has no backend
 * choice and runs once.
 */
export function buildMethods(
  s: MethodSelection,
  deps: LoadDeps,
): BenchMethod[] {
  const out: BenchMethod[] = [];
  if (s.sift) {
    out.push(siftMethod(deps));
  }
  if (s.xfeat) {
    for (const b of s.backends) {
      for (const p of s.precisions) {
        out.push(xfeatMethod(b, p, deps));
      }
    }
  }
  if (s.aliked) {
    for (const b of s.backends) {
      out.push(alikedMethod(b, deps));
    }
  }
  return out;
}

/**
 * What a selection leaves out without saying so: a ticked method with no
 * backend, or XFeat with no model file, gives no method in `buildMethods`.
 * One sentence per gap; empty when every ticked method runs.
 */
export function selectionGaps(s: MethodSelection): string[] {
  const gaps: string[] = [];
  if (s.xfeat && s.backends.length === 0) {
    gaps.push("XFeat is ticked but no backend is");
  }
  if (s.xfeat && s.precisions.length === 0) {
    gaps.push("XFeat is ticked but no model file is");
  }
  if (s.aliked && s.backends.length === 0) {
    gaps.push("ALIKED + LightGlue is ticked but no backend is");
  }
  return gaps;
}

const BACKENDS: readonly Backend[] = ["webgpu", "wasm"];
const PRECISIONS: readonly XFeatPrecision[] = ["fp16", "fp32"];

/** The values of the ticked boxes, known ones in a fixed order. */
function ticked<T extends string>(
  values: readonly string[],
  known: readonly T[],
  what: string,
): T[] {
  for (const v of values) {
    if (!(known as readonly string[]).includes(v)) {
      throw new RangeError(`unknown ${what} "${v}"`);
    }
  }
  return known.filter((k) => values.includes(k));
}

/** The ticked backend boxes, WebGPU first. */
export function backendsFrom(values: readonly string[]): Backend[] {
  return ticked(values, BACKENDS, "backend");
}

/** The ticked XFeat model file boxes, fp16 first. */
export function precisionsFrom(values: readonly string[]): XFeatPrecision[] {
  return ticked(values, PRECISIONS, "model file");
}

/** What a run uses, and the log line that says so. */
export interface RunSettings {
  readonly photoTest: boolean;
  readonly backends: readonly Backend[];
  readonly precisions: readonly XFeatPrecision[];
  readonly runs: number;
  readonly warmup: boolean;
  /** Starts with "runs:"; logged before the run. */
  readonly line: string;
}

/** The one XFeat model file a photo test runs. */
const PHOTO_TEST_PRECISION: XFeatPrecision = "fp16";

const listText = (values: readonly string[]): string =>
  values.length === 0 ? "none" : values.join("+");

/**
 * The settings of a run. A protocol pair (any key but "none") is a photo
 * test and sets the run itself: one run, no warm-up, WebGPU only (WASM
 * where the browser has no WebGPU) and one XFeat model file, whatever the
 * Options say. "none" or no pair (the synthetic run) uses the Options.
 */
export function runSettings(
  options: {
    readonly pair: string | null;
    readonly backends: readonly Backend[];
    readonly precisions: readonly XFeatPrecision[];
    readonly runs: number;
  },
  webgpuAvailable: boolean,
): RunSettings {
  const { pair } = options;
  if (pair === null || pair === "none") {
    return {
      photoTest: false,
      backends: options.backends,
      precisions: options.precisions,
      runs: options.runs,
      warmup: true,
      line: `runs: ${String(options.runs)} after 1 warm-up, backends ${listText(options.backends)}, XFeat files ${listText(options.precisions)} (Options)`,
    };
  }
  const backend: Backend = webgpuAvailable ? "webgpu" : "wasm";
  return {
    photoTest: true,
    backends: [backend],
    precisions: [PHOTO_TEST_PRECISION],
    runs: 1,
    warmup: false,
    line: `runs: 1, no warm-up, backends ${backend}${webgpuAvailable ? "" : " (no WebGPU on this device)"}, XFeat files ${PHOTO_TEST_PRECISION} (photo test ${pair})`,
  };
}

/** The runs field: a whole number from 1 to 50, else the default 5. */
export function parseRuns(value: string): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : 5;
}
