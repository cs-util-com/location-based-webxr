/**
 * The asset optimizer's module Worker: runs the heavy part of an
 * optimization off the page (`optimizer-client.ts` is its page side,
 * `optimizer-protocol.ts` the messages and the loop, `serveSteps`). Each
 * kind's step is a row of the table below: pictures (`picture-step.ts`),
 * sounds (`sound-step.ts`) and 3D models (`model-step.ts`, whose
 * textures go through the picture device); a kind without a step answers
 * "failed" with words.
 * The device seam: not unit-tested (it needs a real Worker); the steps'
 * decisions and the loop are, and the e2e runs this file.
 *
 * @see asset-optimizer.worker.ts.md
 */

import { serveSteps } from "./optimizer-protocol.js";
import { optimizeModel } from "./model-step.js";
import { optimizePicture, PICTURE_DEVICE } from "./picture-step.js";
import { optimizeSound, SOUND_DEVICE } from "./sound-step.js";

// `self` is typed as `Window` under the app's DOM lib (no webworker lib);
// its `postMessage` and `addEventListener` already fit the loop's scope.
serveSteps(self, {
  image: (payload, settings, control) =>
    optimizePicture(payload, settings, control, PICTURE_DEVICE),
  audio: (payload, settings, control) =>
    optimizeSound(payload, settings, control, SOUND_DEVICE),
  model: (payload, settings, control) =>
    optimizeModel(payload, settings, control, PICTURE_DEVICE),
});
