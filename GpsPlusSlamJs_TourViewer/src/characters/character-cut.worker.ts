/**
 * The character-sheet cut's module Worker: wires `cut-service.ts` to the
 * real decoder and `postMessage`, so a 4-megapixel cut never freezes the
 * page. `cut-client.ts` is its page side. The device seam: not
 * unit-tested (it needs a real Worker); the service it runs is.
 *
 * @see character-cut.worker.ts.md
 */

import type { CutAnswer } from "./cut-protocol.js";
import { createCutService } from "./cut-service.js";
import { decodePicture } from "./decode-picture.js";

// `self` is typed as `Window` under the app's DOM lib (no webworker lib).
const ctx = self as unknown as {
  postMessage: (message: CutAnswer, transfer: ArrayBuffer[]) => void;
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent) => void,
  ) => void;
};

const handle = createCutService(decodePicture, (answer, transfer) => {
  ctx.postMessage(answer, transfer);
});

// Requests run one after another: the client sends the next only when the
// last has answered, so no two cuts hold a picture's memory at once.
ctx.addEventListener("message", (event) => {
  void handle(event.data);
});
