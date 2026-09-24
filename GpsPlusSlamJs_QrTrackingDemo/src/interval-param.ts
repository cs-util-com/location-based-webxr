/**
 * Parse an optional QR capture-interval override from the page URL.
 *
 * The field test measures a faster (or slower) detection rate on a real
 * device without a rebuild and without changing the default: the demo reads
 * `?interval=<ms>` and forwards it as the camera-frame `intervalMs`. Absent or
 * invalid → `undefined`, and the framework default stands.
 *
 * @see capture-size-param.ts - the same shape for `?capture=<px>`.
 * @see interval-param.ts.md
 */

import { QR_CAPTURE_INTERVAL_CONSTRAINTS } from "gps-plus-slam-app-framework/ar/qr/qr-capture-cadence";

/**
 * Read `?interval=<ms>` from a URL query string. Returns an integer within the
 * framework's QR capture bounds, or `undefined` when the param is absent,
 * non-numeric, or out of range (a typo must not run the detector at 1 ms or
 * disable the throttle).
 */
export function parseIntervalParam(search: string): number | undefined {
  const raw = new URLSearchParams(search).get("interval");
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  const ms = Math.floor(n);
  const { min, max } = QR_CAPTURE_INTERVAL_CONSTRAINTS;
  if (ms < min || ms > max) return undefined;
  return ms;
}
