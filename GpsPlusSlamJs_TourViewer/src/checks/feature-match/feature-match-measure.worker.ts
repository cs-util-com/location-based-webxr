/**
 * The feature-match measuring worker: wires `measure-worker-core.ts` to
 * the real PNG decoder, this worker's WebGPU probe, the methods built for
 * the worker and `postMessage`, so measuring a pair never freezes the
 * camera preview. `measure-client.ts` is its page side. The device seam:
 * not unit-tested (it needs a real worker); the core it runs is, and the
 * browser test runs it whole.
 *
 * @see feature-match-measure.worker.ts.md
 */
import { buildMethods } from "./bench-methods";
import type { LoadDeps } from "./bench-net";
import { memoFetch } from "./fetch-memo";
import type { MeasureAnswer } from "./measure-protocol";
import { handleMeasure, type MeasureEnv } from "./measure-worker-core";
import { pngFrame } from "./png-frame";
import { webGpuProbe, type GpuProbeLike } from "./webgpu-probe";

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
  build: (selection) => buildMethods(selection, deps, "worker"),
  now: () => performance.now(),
};

// One pair after another: the client sends the next only when the last
// has answered; the chain keeps that order even if it did not. The same
// step runs after a rejection too, so one failure never blocks the rest.
let chain: Promise<void> = Promise.resolve();
ctx.addEventListener("message", (event) => {
  const step = () =>
    handleMeasure(event.data, env, (answer) => ctx.postMessage(answer));
  chain = chain.then(step, step);
});
