/**
 * Whether WebGPU can run here: `navigator.gpu` alone is not enough, as a
 * browser may offer it with no adapter. The page and the measuring worker
 * each ask their own (a dedicated worker has its own `navigator.gpu`).
 *
 * @see webgpu-probe.ts.md
 */

/** The part of `navigator.gpu` the probe uses. */
export interface GpuProbeLike {
  requestAdapter(): Promise<unknown>;
}

/**
 * A function that asks for an adapter once and keeps the answer: true for
 * an adapter, false for no `navigator.gpu`, a null adapter or a throw.
 * `gpu` is read on the first call, not when the probe is made.
 */
export function webGpuProbe(
  gpu: () => GpuProbeLike | undefined,
): () => Promise<boolean> {
  let answer: Promise<boolean> | null = null;
  return () =>
    (answer ??= (async () => {
      const g = gpu();
      if (!g) {
        return false;
      }
      try {
        return (await g.requestAdapter()) !== null;
      } catch {
        return false;
      }
    })());
}
