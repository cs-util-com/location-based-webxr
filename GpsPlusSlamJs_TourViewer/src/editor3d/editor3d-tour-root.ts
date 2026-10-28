/**
 * Where a tour's points stand in the 3D editor's world: one matrix per
 * point (a station, a code). A placed model's size rule is
 * `../model-scale.ts`.
 *
 * A tour writes each point as latitude, longitude and an ELLIPSOIDAL
 * height, and everything at the point in its own north-up-east frame (the
 * frame the phone's AR places in). The globe's relief draws ORTHOMETRIC
 * heights over the ellipsoid, so a point is drawn N (the geoid's
 * undulation) lower than its file says. The matrix is, right to left:
 *
 * - north-up-east turned into east-up-south (the globe frame's axes);
 * - down by N;
 * - the point's own east-up-south frame on the ellipsoid, into ECEF;
 * - the globe's world frame (`worldFromEcef`).
 *
 * With the point's own height on the up axis, (0, alt, 0) lands exactly on
 * the ellipsoid's point of that latitude and longitude at height alt - N,
 * wherever the point is; one matrix for a whole tour would bend a station
 * a few hundred metres out by the frame's flatness, and put the core's
 * flat ruler between the file and the drawing.
 *
 * @see editor3d-tour-root.ts.md
 */
import * as THREE from "three";

import { worldFromEcefAt } from "gps-plus-slam-globe/editor";

/** The ellipsoid the globe's frame functions take. */
export type GlobeEllipsoid = Parameters<typeof worldFromEcefAt>[0];

/** North-up-east (x north, y up, z east) to east-up-south. */
// prettier-ignore
const NUE_TO_EUS = new THREE.Matrix4().set(
  0, 0, 1, 0,
  0, 1, 0, 0,
  -1, 0, 0, 0,
  0, 0, 0, 1,
);

const pointFrame = new THREE.Matrix4();
const lowered = new THREE.Matrix4();

/**
 * The matrix from a point's north-up-east frame (its height on the up
 * axis, as the file writes it) to the world, into `out`. RangeError for a
 * place outside [-90, 90] or not finite, or an undulation that is not
 * finite.
 */
export function pointRootMatrix(
  input: {
    readonly ellipsoid: GlobeEllipsoid;
    /** The globe's world frame: ECEF to the world. */
    readonly worldFromEcef: THREE.Matrix4;
    readonly place: { readonly lat: number; readonly lon: number };
    /** The geoid's N at the place (m). */
    readonly undulationM: number;
  },
  out: THREE.Matrix4,
): THREE.Matrix4 {
  const { ellipsoid, worldFromEcef, place, undulationM } = input;
  if (!Number.isFinite(undulationM)) {
    throw new RangeError(`the geoid's N must be finite, got ${undulationM}`);
  }
  // RangeError for a bad place, from the globe's own check.
  worldFromEcefAt(ellipsoid, { lat: place.lat, lng: place.lon }, pointFrame);
  pointFrame.invert();
  lowered.makeTranslation(0, -undulationM, 0).multiply(NUE_TO_EUS);
  return out.copy(worldFromEcef).multiply(pointFrame).multiply(lowered);
}
