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

/** The runs field: a whole number from 1 to 50, else the default 5. */
export function parseRuns(value: string): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : 5;
}
