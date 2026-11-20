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

/** The backend select's value as a list ("both" is WebGPU then WASM). */
export function backendsFor(value: string): Backend[] {
  if (value === "webgpu" || value === "wasm") {
    return [value];
  }
  if (value === "both") {
    return ["webgpu", "wasm"];
  }
  throw new RangeError(`unknown backend choice "${value}"`);
}

/** The precision select's value as a list ("both" is fp16 then fp32). */
export function precisionsFor(value: string): XFeatPrecision[] {
  if (value === "fp16" || value === "fp32") {
    return [value];
  }
  if (value === "both") {
    return ["fp16", "fp32"];
  }
  throw new RangeError(`unknown precision choice "${value}"`);
}

/** The runs field: a whole number from 1 to 50, else the default 5. */
export function parseRuns(value: string): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : 5;
}
