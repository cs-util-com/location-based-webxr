/**
 * The model converter's module Worker: runs each import's conversion
 * (`import-step.ts`) off the page, over the optimizer's protocol and loop
 * (`serveSteps`); its page side is `model-import-runner.ts`. A Worker of
 * its own, so a model that runs it out of memory takes only the
 * conversion down, never an optimization in progress.
 * The device seam: not unit-tested (it needs a real Worker); the step and
 * the loop are, and the e2e runs this file.
 *
 * @see model-import.worker.ts.md
 */
import { serveSteps } from "../asset-shelf/optimizer-protocol.js";
import { convertImport } from "./import-step.js";

// `self` is typed as `Window` under the app's DOM lib (no webworker lib);
// its `postMessage` and `addEventListener` already fit the loop's scope.
serveSteps(self, {
  model: (payload, settings, control) =>
    convertImport(payload, settings, control),
});
