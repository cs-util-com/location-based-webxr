/**
 * The worker spike's XFeat probe: the measuring worker's own wiring
 * (`measure-worker-env.ts`) with XFeat as the only method, so the spike
 * learns whether XFeat's runtime (LiteRT.js) starts in a module worker.
 * The measuring worker itself never builds XFeat (`measure-worker-core.ts`
 * turns it off), so this is a separate worker; the page talks to it with
 * the same client (`measure-client.ts`).
 *
 * @see xfeat-probe.worker.ts.md
 */
import { serveMeasureWorker } from "./measure-worker-env";

serveMeasureWorker((s) => ({
  ...s,
  sift: false,
  xfeat: true,
  aliked: false,
  siftLightGlue: false,
}));
