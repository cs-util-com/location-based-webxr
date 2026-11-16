/**
 * Where the worker's OPFS tile store reports a failed write or listing: the
 * framework logger, tagged `OsmBlobStore`, so the failure is logged to the
 * console and kept in the worker's log buffer, as before the store stopped
 * importing the logger itself (the store must load in the design system's
 * no-build labs, which cannot load the logger's error-report dependency).
 * Whether a warning also reaches an error report depends on whether the app
 * starts error reporting; this module neither starts nor assumes it.
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
