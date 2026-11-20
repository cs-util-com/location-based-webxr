/**
 * The splat trainer's module Worker: wires `worker-train.ts` to the real
 * Splat.js import, photo decoder and clock, and to `postMessage`, so the
 * graphics card's training never freezes the page. `gpu-trainer.ts` is its
 * page side, and `trainer-worker-spawn.ts` starts it. The device seam: not
 * unit-tested (it needs a real Worker and a graphics card); the work it
 * runs is.
 *
 * @see splat-trainer.worker.ts.md
 */

import {
  loadSplatJs,
  SHIM_IMPORT_KEY,
  type ModuleImporter,
} from "./splat-js.js";
import {
  trainInWorker,
  type DecodedPhoto,
  type FromWorker,
  type ToWorker,
} from "./worker-train.js";

// `self` is typed as `Window` under the app's DOM lib (no webworker lib).
const ctx = self as unknown as {
  postMessage: (message: FromWorker) => void;
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<ToWorker>) => void,
  ) => void;
};

/** A photo's RGBA pixels, decoded with no DOM. */
async function decode(photo: Blob): Promise<DecodedPhoto> {
  const bitmap = await createImageBitmap(photo);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const g = canvas.getContext("2d", { willReadFrequently: true });
    if (g === null) throw new Error("no 2D canvas in this worker");
    g.drawImage(bitmap, 0, 0);
    return g.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

/**
 * Imports through the `blob:` start module's importer
 * (`trainer-worker-spawn.ts`). Read when called, not when this module
 * loads: the start module's body runs after its import of this script.
 * Without the importer nothing is loaded, so no request can carry this
 * site's origin.
 */
const shimImport: ModuleImporter = (url) => {
  const importer = (
    globalThis as unknown as Record<string, ModuleImporter | undefined>
  )[SHIM_IMPORT_KEY];
  return importer === undefined
    ? Promise.reject(new Error("the worker was not started from its shim"))
    : importer(url);
};

let running: AbortController | null = null;

ctx.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "cancel") {
    running?.abort();
    return;
  }
  // One window per worker: the page spawns a fresh one for each.
  if (running !== null) return;
  const ctrl = new AbortController();
  running = ctrl;
  void trainInWorker(
    msg,
    (progress) => ctx.postMessage({ type: "progress", progress }),
    ctrl.signal,
    {
      load: () => loadSplatJs(shimImport),
      decode,
      clock: {
        now: () => performance.now(),
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (id) => clearTimeout(id as number),
      },
    },
  ).then((result) => ctx.postMessage({ type: "result", result }));
});
