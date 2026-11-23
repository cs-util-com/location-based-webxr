/**
 * The browser half of a measuring worker: wires `measure-worker-core.ts`
 * to the real PNG decoder, this worker's WebGPU probe, the methods built
 * for the worker and `postMessage`, and answers the page's requests one
 * after another. `feature-match-measure.worker.ts` serves the page's
 * selection unchanged; the worker spike's XFeat probe swaps it for XFeat
 * alone. The device seam: not unit-tested (it needs a real worker); the
 * core it runs is, and the browser test runs it whole.
 *
 * @see measure-worker-env.ts.md
 */
import { buildMethods, type MethodSelection } from "./bench-methods";
import type { LoadDeps } from "./bench-net";
import { memoFetch } from "./fetch-memo";
import type { MeasureAnswer } from "./measure-protocol";
import { handleMeasure, type MeasureEnv } from "./measure-worker-core";
import { pngFrame } from "./png-frame";
import { webGpuProbe, type GpuProbeLike } from "./webgpu-probe";

/**
 * Starts answering measure requests in this worker. `pick` turns the
 * selection the core asks for into the one that is built (unchanged by
 * default).
 */
export function serveMeasureWorker(
  pick: (selection: MethodSelection) => MethodSelection = (s) => s,
): void {
  // `self` is typed as `Window` under the app's DOM lib (no webworker lib).
  const ctx = self as unknown as {
    postMessage: (message: MeasureAnswer) => void;
    addEventListener: (
      type: "message",
      listener: (event: MessageEvent) => void,
    ) => void;
  };

  // The models are fetched once per worker, not once per pair.
  const deps: LoadDeps = {
    importModule: (url) => import(/* @vite-ignore */ url) as Promise<unknown>,
    fetch: memoFetch((url, init) => fetch(url, init)),
    now: () => performance.now(),
    resources: () =>
      performance.getEntriesByType("resource") as PerformanceResourceTiming[],
  };

  const env: MeasureEnv = {
    decode: pngFrame,
    webgpu: webGpuProbe(
      () => (navigator as Navigator & { gpu?: GpuProbeLike }).gpu,
    ),
    build: (selection) => buildMethods(pick(selection), deps, "worker"),
    now: () => performance.now(),
  };

  // One pair after another: the client sends the next only when the last
  // has answered; the chain keeps that order even if it did not.
  let chain: Promise<void> = Promise.resolve();
  ctx.addEventListener("message", (event) => {
    chain = chain.then(() =>
      handleMeasure(event.data, env, (answer) => ctx.postMessage(answer)),
    );
  });
}
