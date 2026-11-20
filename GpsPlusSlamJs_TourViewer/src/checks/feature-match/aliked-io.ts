/**
 * Tensor plumbing of the split ALIKED extractor and LightGlue matcher ONNX
 * models: the image input, picking outputs, stacking a pair for the
 * matcher and reading its matches.
 *
 * @see aliked-io.ts.md
 */
import type { Frame } from "./bench-image";

/** The frame as RGB in [0, 1], channels first (1 x 3 x H x W). */
export function chwInput(frame: Frame): Float32Array {
  const n = frame.width * frame.height;
  const out = new Float32Array(3 * n);
  const s = frame.rgba;
  for (let i = 0; i < n; i++) {
    out[i] = s[i * 4]! / 255;
    out[n + i] = s[i * 4 + 1]! / 255;
    out[2 * n + i] = s[i * 4 + 2]! / 255;
  }
  return out;
}

/**
 * The name to read an output or feed an input by: `preferred` when the
 * model has it, else the name at `index` (export tools rename freely).
 *
 * @throws Error when neither exists.
 */
export function pickName(
  names: readonly string[],
  preferred: string,
  index: number,
): string {
  if (names.includes(preferred)) {
    return preferred;
  }
  const byIndex = names[index];
  if (byIndex === undefined) {
    throw new Error(
      `model has no "${preferred}" and no name at ${String(index)} (${names.join(", ")})`,
    );
  }
  return byIndex;
}

/** A and B's arrays one after the other: the matcher's pair batch. */
export function stackPair(a: Float32Array, b: Float32Array): Float32Array {
  if (a.length !== b.length) {
    throw new RangeError(
      `pair halves differ in size: ${String(a.length)} and ${String(b.length)}`,
    );
  }
  const out = new Float32Array(a.length * 2);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * The matcher's `matches0` (for each keypoint of A, its index in B or -1)
 * as flat pairs `[ia, ib, ...]`; indices outside B are dropped.
 */
export function pairsFromMatches(
  matches0: ArrayLike<number | bigint>,
  countB: number,
): Int32Array {
  const out: number[] = [];
  for (let i = 0; i < matches0.length; i++) {
    const m = Number(matches0[i]);
    if (m >= 0 && m < countB) {
      out.push(i, m);
    }
  }
  return Int32Array.from(out);
}

/** A float32 output's data, or an error naming what came instead. */
export function floatData(data: unknown, what: string): Float32Array {
  if (data instanceof Float32Array) {
    return data;
  }
  throw new Error(`${what}: expected float32 data`);
}
