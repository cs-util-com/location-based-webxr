/**
 * The splat trainer's module Worker: wires `worker-train.ts` to the real
 * Splat.js import, photo decoder and clock, and to `postMessage`, so the
 * graphics card's training never freezes the page. It draws the looks at
 * the model the page shows while a stretch trains, on its own canvas with
 * the trainer's device, and hands each over as an ImageBitmap. `gpu-trainer.ts` is its
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
  type SplatTrainerLike,
} from "./splat-js.js";
import {
  serveTrainer,
  type DecodedPhoto,
  type FromWorker,
  type ToWorker,
} from "./worker-train.js";

// `self` is typed as `Window` under the app's DOM lib (no webworker lib).
const ctx = self as unknown as {
  postMessage: (message: FromWorker, transfer?: Transferable[]) => void;
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
 * page's address as its Referer.
 */
const shimImport: ModuleImporter = (url) => {
  const importer = (
    globalThis as unknown as Record<string, ModuleImporter | undefined>
  )[SHIM_IMPORT_KEY];
  return importer === undefined
    ? Promise.reject(new Error("the worker was not started from its shim"))
    : importer(url);
};

/** Time between looks at the model while it trains (ms). */
const PREVIEW_EVERY_MS = 15_000;

/** The look canvas, made again only when the camera's size changes. */
let look: {
  canvas: OffscreenCanvas;
  gpu: { configure(c: unknown): void };
  device: unknown;
} | null = null;

/**
 * The model as seen from training camera `ci`, drawn with the trainer's
 * own device into this worker's canvas; null when the trainer cannot draw
 * one (no device, no camera size, no WebGPU canvas).
 */
function takeLook(trainer: SplatTrainerLike, ci: number): ImageBitmap | null {
  const meta = trainer.camMeta[ci] as { w?: unknown; h?: unknown } | undefined;
  const w = meta?.w;
  const h = meta?.h;
  if (
    typeof w !== "number" ||
    typeof h !== "number" ||
    !(w > 0 && h > 0) ||
    trainer.device === undefined ||
    trainer.canvasFormat === undefined ||
    trainer.renderTrainCam === undefined
  ) {
    return null;
  }
  if (
    look === null ||
    look.canvas.width !== w ||
    look.canvas.height !== h ||
    look.device !== trainer.device
  ) {
    const canvas = new OffscreenCanvas(w, h);
    const gpu = canvas.getContext("webgpu" as "2d") as unknown as {
      configure(c: unknown): void;
    } | null;
    if (gpu === null) return null;
    gpu.configure({
      device: trainer.device,
      format: trainer.canvasFormat,
      alphaMode: "opaque",
    });
    look = { canvas, gpu, device: trainer.device };
  }
  trainer.renderTrainCam(ci, look.gpu);
  return look.canvas.transferToImageBitmap();
}

// The page stops a window by ending this worker, so it only ever trains.
const serve = serveTrainer((message) => ctx.postMessage(message), {
  load: () => loadSplatJs(shimImport),
  decode,
  clock: {
    now: () => performance.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as number),
  },
  preview: {
    everyMs: PREVIEW_EVERY_MS,
    take: takeLook,
    post: (picture) => ctx.postMessage({ type: "preview", picture }, [picture]),
  },
});

ctx.addEventListener("message", (event) => serve(event.data));
