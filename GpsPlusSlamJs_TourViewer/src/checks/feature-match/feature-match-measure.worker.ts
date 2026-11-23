/**
 * The feature-match measuring worker, so measuring a pair never freezes
 * the camera preview: it serves the page's method selection unchanged
 * (`measure-worker-env.ts`). `measure-client.ts` is its page side.
 *
 * @see feature-match-measure.worker.ts.md
 */
import { serveMeasureWorker } from "./measure-worker-env";

serveMeasureWorker();
