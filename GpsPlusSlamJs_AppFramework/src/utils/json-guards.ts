/**
 * The type guards every hand-edited-JSON parser needs (`qr/qr-level.ts`,
 * `qr/geo-pose.ts`, `tour-manifest.ts` here; the Tour Viewer's stored
 * records by deep import): an object, a JSON object that is no array, and a
 * finite number, in one module so the workspace keeps one implementation of
 * each.
 */

/** A non-null object (a JSON object or array; callers narrow further). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** A JSON object: a non-null object that is not an array. */
export function isJsonObject(v: unknown): v is Record<string, unknown> {
  return isRecord(v) && !Array.isArray(v);
}

/** A number that is neither NaN nor infinite. */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
