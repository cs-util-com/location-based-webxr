/**
 * The geo-pose validator shared by the level file (`qr-level.ts`, the
 * printed code's own pose) and the tour manifest (`../tour-manifest.ts`,
 * every placed object's pose). One parser, because the two documents carry
 * the SAME shape - lat, lon, absolute altitude, a NUE unit quaternion and/or
 * a compass heading - and two copies of the heading/rotation consistency
 * rule would drift exactly where a wrong answer mis-places content
 * silently (DEC-H3). Moved out of `qr-level.ts` for the guided-setup plan
 * (2026-09-08); the level's tests pin the messages, so the caller passes
 * the document path the message names and the error to throw.
 */

import { bearingDeltaDeg, type Quaternion } from 'gps-plus-slam-js';
import { normalizeBearingDeg } from '../../utils/bearing-degrees.js';
import { isFiniteNumber, isRecord } from '../../utils/json-guards.js';
import {
  deriveVerticalHeading,
  renormalizeUnitQuaternion,
} from './qr-geo-pose-minting.js';
import type { QrGeoOrientation, QrGeoPose } from './qr-gps-vote.js';

/** Max tolerated disagreement between an authored `headingDeg` and the
 *  bearing its `rotation` implies before the document rejects as
 *  self-contradictory (QR-pose plan milestone review #5). */
export const HEADING_CONSISTENCY_TOLERANCE_DEG = 2;

export interface ParseGeoPoseOptions {
  /** The document path of the value, used verbatim in messages
   *  (`"qr.geo"` for a level, `"objects[3].geo"` for a manifest). */
  path: string;
  /** Builds the error the caller's document type throws. */
  fail: (message: string) => never;
}

/**
 * Validate a geo pose. Every field is validated (a partial pose is a bug -
 * it would silently place the vote or the object wrong); heading is
 * normalised into `[0, 360)`; a rotation is renormalised within the shared
 * tolerance; heading and rotation must agree when both are present.
 */
export function parseGeoPose(
  value: unknown,
  options: ParseGeoPoseOptions
): QrGeoPose {
  const { path, fail } = options;
  if (!isRecord(value)) {
    return fail(`"${path}" must be an object`);
  }
  const { lat, lon, alt, headingDeg } = value;
  if (!isFiniteNumber(lat) || lat < -90 || lat > 90) {
    return fail(`"${path}.lat" must be a number in [-90, 90]`);
  }
  if (!isFiniteNumber(lon) || lon < -180 || lon > 180) {
    return fail(`"${path}.lon" must be a number in [-180, 180]`);
  }
  if (!isFiniteNumber(alt)) {
    return fail(`"${path}.alt" must be a finite number`);
  }
  return {
    lat,
    lon,
    alt,
    ...parseOrientation(headingDeg, value.rotation, options),
  };
}

/**
 * The orientation half (6-DoF extension, QR-pose plan 2026-08-25):
 * `headingDeg` is optional WHEN a rotation is present - a floor/ceiling
 * code has no honest heading, and a filler read by a rotation-unaware
 * consumer would silently mis-place it. A pose with NEITHER cannot orient
 * anything and rejects loudly.
 */
function parseOrientation(
  headingDeg: unknown,
  rotationValue: unknown,
  { path, fail }: ParseGeoPoseOptions
): QrGeoOrientation {
  const rotation = parseRotation(rotationValue, { path, fail });
  if (headingDeg !== undefined && !isFiniteNumber(headingDeg)) {
    return fail(`"${path}.headingDeg" must be a finite number when present`);
  }
  const normalized = isFiniteNumber(headingDeg)
    ? normalizeBearingDeg(headingDeg)
    : undefined;
  if (rotation === undefined) {
    if (normalized === undefined) {
      return fail(`"${path}" must carry "headingDeg" and/or "rotation"`);
    }
    return { headingDeg: normalized };
  }
  if (normalized === undefined) return { rotation };
  // Both present: they must AGREE. The whole point of the optional heading
  // is that a wrong one read by a rotation-unaware consumer mis-places the
  // code silently - accepting a contradictory pair would leave exactly that
  // failure open for hand-authored or half-migrated files.
  const derived = deriveVerticalHeading(rotation);
  if (derived === undefined) {
    return fail(
      `"${path}.headingDeg" contradicts "rotation": the rotation is not near-vertical, so no heading is honest`
    );
  }
  if (
    Math.abs(bearingDeltaDeg(derived, normalized)) >
    HEADING_CONSISTENCY_TOLERANCE_DEG
  ) {
    return fail(
      `"${path}.headingDeg" (${normalized.toFixed(1)}°) contradicts "rotation" (bearing ${derived.toFixed(1)}°)`
    );
  }
  return { headingDeg: normalized, rotation };
}

/**
 * Validate an optional `rotation`: a unit quaternion `[x, y, z, w]` in the
 * NUE GPS-world frame (see {@link QrGeoPose}). A small norm drift (≤ 1e-3,
 * e.g. JSON round-trip loss) is renormalized; anything further off is a
 * broken file, not a rotation.
 */
function parseRotation(
  value: unknown,
  { path, fail }: ParseGeoPoseOptions
): Quaternion | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every(isFiniteNumber)
  ) {
    return fail(
      `"${path}.rotation" must be an array of 4 finite numbers when present`
    );
  }
  // Checked element reads: the length===4 guard above makes these always
  // defined, but `noUncheckedIndexedAccess` (tsc) and the every()-narrowing
  // eslint sees disagree about destructuring - this form satisfies both.
  const [x, y, z, w] = [value[0], value[1], value[2], value[3]];
  if (
    x === undefined ||
    y === undefined ||
    z === undefined ||
    w === undefined
  ) {
    return fail(
      `"${path}.rotation" must be an array of 4 finite numbers when present`
    );
  }
  // The tolerance, the idempotent renormalization (the exact-round-trip
  // guarantee stands on it - CI property seed on r574) and the -0
  // canonicalization all live in the shared writer/reader contract:
  // `renormalizeUnitQuaternion` in qr-geo-pose-minting.ts.
  const renormalized = renormalizeUnitQuaternion([x, y, z, w]);
  if (renormalized === undefined) {
    return fail(`"${path}.rotation" must be a unit quaternion`);
  }
  return renormalized;
}
