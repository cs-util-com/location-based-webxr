/**
 * The worker spike's module Worker (throwaway): answers the page's
 * requests one at a time with `worker-spike-cells.ts`, so the methods load
 * and run here exactly as the background queue's worker would run them.
 *
 * @see worker-spike.worker.ts.md
 */
import { errorText } from "./bench-net";
import {
  contextFacts,
  pngRoundTrip,
  runCell,
  type CellRequest,
} from "./worker-spike-cells";

/** What the page asks for. */
export type SpikeAsk =
  | { readonly kind: "facts" }
  | { readonly kind: "cell"; readonly cell: CellRequest }
  | {
      readonly kind: "png";
      readonly png: Blob;
      readonly rgba: Uint8ClampedArray;
      readonly width: number;
      readonly height: number;
    };

/** A request on the wire; `id` comes back on the answer. */
type SpikeRequest = SpikeAsk & { readonly id: number };

// `self` is typed as `Window` under the app's DOM lib (no webworker lib).
const ctx = self as unknown as {
  postMessage: (message: unknown) => void;
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<SpikeRequest>) => void,
  ) => void;
};

const answer = async (req: SpikeRequest): Promise<unknown> => {
  switch (req.kind) {
    case "facts":
      return contextFacts();
    case "cell":
      return runCell(req.cell, "worker", (line) => {
        ctx.postMessage({ id: req.id, line });
      });
    case "png":
      return pngRoundTrip(req.png, req.rgba, req.width, req.height);
  }
};

// The page sends the next request only after this one answered.
ctx.addEventListener("message", (event) => {
  const req = event.data;
  answer(req).then(
    (result) => ctx.postMessage({ id: req.id, result }),
    (e: unknown) => ctx.postMessage({ id: req.id, error: errorText(e) }),
  );
});
