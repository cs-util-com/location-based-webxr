/**
 * The location permission `enable()` asks for, settled WITHOUT waiting for
 * a fix (QR-first M1b-1 review #1). The framework's own requester fetches a
 * position (high accuracy, no cache, 10 s) and calls anything but a fix a
 * failure, so a visitor indoors who had allowed location could never start
 * AR. Here a permission that reads granted answers at once, and a request
 * whose position did not come (a timeout, no position) counts as granted -
 * only a refusal refuses. The session's GPS watch then picks up the first
 * fix whenever it comes, and a scanned code places the tour meanwhile (M1).
 *
 * @see location-permission.ts.md
 */

import type { PermissionStatus } from "gps-plus-slam-app-framework/sensors";

import type { LocationPermission } from "./visitor-screen.js";

export function locationPermissionWithoutFix(deps: {
  /** The browser's permission state (`navigator.permissions`). */
  readonly query: () => Promise<LocationPermission>;
  /** The framework's requester (prompts when the browser still asks). */
  readonly request: () => Promise<PermissionStatus>;
}): () => Promise<PermissionStatus> {
  return async () => {
    let state: LocationPermission = "unknown";
    try {
      state = await deps.query();
    } catch {
      // No permissions API: the request decides.
    }
    if (state === "granted") return { supported: true, granted: true };
    const result = await deps.request();
    // `granted: null` with the API present is a position problem (timeout,
    // unavailable), never a refusal: PERMISSION_DENIED reads `false`.
    if (result.supported && result.granted === null) {
      return { supported: true, granted: true };
    }
    return result;
  };
}
