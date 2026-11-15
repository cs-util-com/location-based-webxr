/**
 * The two type guards every hand-edited-JSON parser in this package needs
 * (`qr/qr-level.ts`, `qr/geo-pose.ts`, `tour-manifest.ts`): a JSON object
 * and a finite number. The package's one deliberate copy (shared-helper rule:
 * shared behaviour has one implementation, a dependency-free one-liner may
 * exist once per package) - three had grown in this package.
 */

/** A non-null object (a JSON object or array; callers narrow further). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** A number that is neither NaN nor infinite. */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
