/**
 * The near clouds' bakes for the globe lab, off the main thread: the Globe
 * package's core with the worker's `postMessage`.
 *
 * @see globe-cloud-bake-worker.js.md
 */
import { createCloudBakeWorkerCore } from "/globe/globe-cloud-bake-worker-core.js";

const core = createCloudBakeWorkerCore((message, transfer) => {
  self.postMessage(message, [...transfer]);
});

self.addEventListener("message", (event) => core.handle(event.data));
