/**
 * Where the worker's OPFS tile store reports a failed write or listing: the
 * framework logger, tagged `OsmBlobStore`, so the failure is logged, kept in
 * the log buffer and reported as a Sentry Issue exactly as before the store
 * stopped importing the logger itself (round-5 plan 2026-10-01-0945 §3.6:
 * the store must load in the no-build labs, which cannot load Sentry).
 *
 * Its own module so a test can pin both halves: that this function reaches
 * the logger, and that `demo-worker.ts` passes it to the store.
 *
 * @see osm-store-warn.ts.md
 */

import { createLogger } from "gps-plus-slam-app-framework/utils/logger";
import type { OsmBlobStoreWarn } from "gps-plus-slam-app-framework/osm-bridge";

const log = createLogger("OsmBlobStore");

/** The worker's store warnings, through the framework logger. */
export const osmStoreWarn: OsmBlobStoreWarn = (message, details) => {
  log.warn(message, details);
};
