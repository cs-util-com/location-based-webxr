/**
 * Starts the splat trainer's worker so that its request for Splat.js names
 * no page. The worker is created from a small `blob:` module, which
 * inherits the page's referrer policy (`no-referrer`, set in
 * `splat/index.html`). That module leaves an importer under
 * {@link SHIM_IMPORT_KEY} and then imports the built worker script by its
 * absolute address; the worker loads Splat.js only through that importer,
 * because an `import()` written in a module served by this site would
 * send this page's address as the Referer. The `blob:` address is released when the worker
 * is ended.
 *
 * @see trainer-worker-spawn.ts.md
 */

import workerUrl from "./splat-trainer.worker.ts?worker&url";

import type { WorkerLike } from "./gpu-trainer.js";
import { SHIM_IMPORT_KEY } from "./splat-js.js";

/**
 * The source of the `blob:` module that leaves its importer and loads the
 * worker at `url`. The worker reads the importer only when a stretch
 * starts, after this module's body has run.
 */
export function workerShimSource(url: string): string {
  return (
    `globalThis[${JSON.stringify(SHIM_IMPORT_KEY)}] = (u) => import(u);\n` +
    `import ${JSON.stringify(url)};\n`
  );
}

export function spawnTrainerWorker(): WorkerLike {
  const absolute = new URL(workerUrl, location.href).href;
  const shim = URL.createObjectURL(
    new Blob([workerShimSource(absolute)], { type: "text/javascript" }),
  );
  const worker = new Worker(shim, { type: "module" });
  const terminate = worker.terminate.bind(worker);
  worker.terminate = () => {
    terminate();
    URL.revokeObjectURL(shim);
  };
  return worker as unknown as WorkerLike;
}
