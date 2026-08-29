/**
 * Anchor MINTING for a printed QR: compose the code's GPS-world pose (as
 * observed under the CURRENT session alignment) into the `QrGeoPose` a level
 * file carries — the authoring half of the QR-pose loop (plan
 * `2026-08-25-1227-qr-pose-tour-relocalization-plan.md`, M1).
 *
 * Honesty contract (plan §2): the result inherits this session's alignment
 * error — it buys later visitors CONSISTENCY with the author's session, not
 * absolute truth. Callers record measurement quality alongside in the
 * level's typed `qr.mintQuality` block (see `qr-level.ts`).
 *
 * Frame contract (the bug class this signature exists to prevent): inputs
 * are **GPS-world NUE** (x = North, y = Up, z = East) — i.e. sampled from an
 * object under an `arWorldGroup` whose matrix carries the alignment (see
 * `enableArWorldGroupAlignment`), e.g. `getWorldPosition()` of a QR-glued
 * `qr-debug-view` object. Feeding a raw-WebXR pose here yields a
 * plausible-looking result rotated about the zero reference.
 */

import type { LatLong, Quaternion } from 'gps-plus-slam-js';

import { worldNueToGps } from '../../visualization/frame-conversions.js';
import type { QrGeoPose } from './qr-gps-vote.js';
import { rotateVectorByQuaternion } from './qr-pose.js';
import { normalizeBearingDeg } from '../../utils/bearing-degrees.js';

export interface MintQrGeoPoseInput {
  /** QR centre in GPS-world NUE metres (x=North, y=Up, z=East). NOTE the
   *  stack's altitude convention: GPS points enter alignment with
   *  `calcRelativeCoordsInMeters(zero, …, altitude, 0)` — the zero's
   *  altitude term is hardcoded `0` (`gpsDataSlice`), so GPS-world `y` IS
   *  the absolute altitude, not an offset from the zero reference. */
  readonly worldNuePosition: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  /** QR orientation as a unit quaternion in the NUE GPS-world frame, over
   *  the local axes `buildObjectPoints` pins (+x right, +y up, +z out of
   *  the printed face). Recipe for a QR-glued three.js object riding the
   *  `WEBXR_TO_NUE` basis node under an aligned `arWorldGroup`
   *  (`qr-debug-view`): `object.getWorldQuaternion(q)` →
   *  `[q.x, q.y, q.z, q.w]` — that basis is a proper rotation (det +1), so
   *  no handedness correction is needed. */
  readonly worldNueRotation: Quaternion;
  /** The session's GPS zero reference. */
  readonly zero: LatLong;
}

/**
 * A code is "near-vertical" (wall-poster convention, compat `headingDeg`
 * emitted) when its local +y stays within this many degrees of world Up.
 * Derivation (milestone review #7): the heading path idealizes tilt away,
 * and a rotation-unaware reader pays ≈ baseline·sin(tilt) per wide-baseline
 * correspondence — 3° at a 10 m ring is ≈0.52 m, inside the field-test's
 * 2 m walk-away budget; the plan's earlier guardrail number was also 3°.
 * Rotation-aware readers are unaffected (they use the exact quaternion).
 */
const VERTICAL_TOLERANCE_DEG = 3;

export function mintQrGeoPose(input: MintQrGeoPoseInput): QrGeoPose {
  const { worldNuePosition, worldNueRotation, zero } = input;
  if (
    ![worldNuePosition.x, worldNuePosition.y, worldNuePosition.z].every(
      Number.isFinite
    )
  ) {
    throw new RangeError('mintQrGeoPose: position must be finite');
  }
  const rotation = normalizeUnitQuaternion(worldNueRotation);

  // `worldNueToGps` already returns the ABSOLUTE altitude (= worldNue.y —
  // the alignment maps odom into a frame whose Up is absolute altitude, see
  // MintQrGeoPoseInput). The first version added a zeroAltitude on top,
  // double-counting by the fix altitude; the milestone review's consumer
  // round-trip test now pins the correct semantics.
  const gps = worldNueToGps(worldNuePosition, zero);
  const headingDeg = deriveVerticalHeading(rotation);
  return {
    lat: gps.lat,
    lon: gps.lon,
    // = gps.altitude by worldNueToGps's contract; spelled as the input so
    // the optionally-typed altitude field cannot type-launder undefined.
    alt: worldNuePosition.y,
    rotation,
    ...(headingDeg !== undefined ? { headingDeg } : {}),
  };
}

function normalizeUnitQuaternion(q: Quaternion): Quaternion {
  const [x, y, z, w] = q;
  if (![x, y, z, w].every(Number.isFinite)) {
    throw new RangeError('mintQrGeoPose: rotation must be finite');
  }
  const renormalized = renormalizeUnitQuaternion(q);
  if (renormalized === undefined) {
    throw new RangeError(
      `mintQrGeoPose: rotation must be a unit quaternion (|q| = ${Math.hypot(x, y, z, w)})`
    );
  }
  return renormalized;
}

/**
 * The ONE renormalization contract for authored/minted unit quaternions —
 * shared by `mintQrGeoPose` (writer) and `parseQrLevel`'s rotation parsing
 * (reader), so the two halves of the level-file round-trip can never
 * disagree (DEC-H3: shared behaviour is unified). Accepts a norm within
 * 1e-3 of 1 (JSON round-trip loss), returns `undefined` for anything
 * further off (callers throw their own error type).
 *
 * Renormalization is IDEMPOTENT: a norm already within 1e-12 of 1 passes
 * the components through bit-exact. Dividing by a 1-within-rounding norm
 * shifts each component a last-bit step per application, so a
 * parse → serialize(re-validates) → parse cycle drifted 1 ULP and broke
 * the exact round-trip property (CI seed on r574). One real division lands
 * the norm within a few ULP of 1 — inside the threshold — making a second
 * pass the identity. Also canonicalizes -0 → +0 (JSON cannot carry -0).
 */
export function renormalizeUnitQuaternion(
  q: Quaternion
): Quaternion | undefined {
  const [x, y, z, w] = q;
  const norm = Math.hypot(x, y, z, w);
  if (Math.abs(norm - 1) > 1e-3) return undefined;
  const scale = Math.abs(norm - 1) > 1e-12 ? norm : 1;
  return [x / scale + 0, y / scale + 0, z / scale + 0, w / scale + 0];
}

/**
 * The compat `headingDeg` — defined only when the code is near-vertical
 * (local +y within {@link VERTICAL_TOLERANCE_DEG} of Up): the bearing of the
 * rotated local +x, clockwise from North. A tilted/flat code gets no
 * heading; a rotation-unaware reader then fails LOUD in `parseQrLevel`
 * instead of silently placing it as a wall poster. Exported for
 * `qr-level.ts`'s both-fields consistency check (milestone review #5).
 */
export function deriveVerticalHeading(
  rotation: Quaternion
): number | undefined {
  const localUp = rotateVectorByQuaternion(rotation, [0, 1, 0]);
  const cosTolerance = Math.cos((VERTICAL_TOLERANCE_DEG * Math.PI) / 180);
  if (localUp[1] < cosTolerance) return undefined;
  const localX = rotateVectorByQuaternion(rotation, [1, 0, 0]);
  // NUE: [0] = North, [2] = East; bearing clockwise from North.
  const bearing = (Math.atan2(localX[2], localX[0]) * 180) / Math.PI;
  return normalizeBearingDeg(bearing);
}
