/**
 * Where a tour's points stand in the 3D editor's world: one matrix per
 * point (a station, a code), and the size rule for a placed model.
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

const box = new THREE.Box3();
const part = new THREE.Box3();
const size = new THREE.Vector3();
const toModel = new THREE.Matrix4();
const partToModel = new THREE.Matrix4();

/**
 * The factor that makes `model`'s largest side `sizeM` metres: the
 * format's one rule, the axis-aligned box of the model at rest (its
 * geometries' own boxes), node transforms included, in the model's own
 * frame (wherever it is placed, its own transform left out). 1 for a model
 * with nothing to measure (no extent). RangeError for a size that is not
 * finite and > 0.
 */
export function modelScale(model: THREE.Object3D, sizeM: number): number {
  if (!(Number.isFinite(sizeM) && sizeM > 0)) {
    throw new RangeError(`a model's size must be finite and > 0, got ${sizeM}`);
  }
  model.updateMatrixWorld(true);
  toModel.copy(model.matrixWorld).invert();
  box.makeEmpty();
  model.traverse((o) => {
    const geometry = (o as THREE.Mesh).geometry as
      THREE.BufferGeometry | undefined;
    if (geometry === undefined) return;
    if (geometry.boundingBox === null) geometry.computeBoundingBox();
    if (geometry.boundingBox === null) return;
    partToModel.multiplyMatrices(toModel, o.matrixWorld);
    box.union(part.copy(geometry.boundingBox).applyMatrix4(partToModel));
  });
  if (box.isEmpty()) return 1;
  const largest = Math.max(...box.getSize(size).toArray());
  return largest > 0 && Number.isFinite(largest) ? sizeM / largest : 1;
}

/** A point of the tour as the centre reads it (degrees, ellipsoidal m). */
interface GeoPoint {
  readonly lat: number;
  readonly lon: number;
  readonly alt: number;
}

/**
 * The tour's centre for the 3D view's frame and first orbit: the mean
 * latitude, longitude and height of its stations, or of its codes when it
 * has no station; null with neither. A point with a coordinate that is not
 * finite is left out. (A tour spans a few hundred metres: the plain mean
 * of degrees is the centre to well under a metre there.)
 */
export function tourCentre(
  stations: readonly { readonly geo: GeoPoint }[],
  codes: readonly GeoPoint[],
): { lat: number; lng: number; altM: number } | null {
  const placed = (points: readonly GeoPoint[]) =>
    points.filter(
      (p) =>
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lon) &&
        Number.isFinite(p.alt),
    );
  const fromStations = placed(stations.map((s) => s.geo));
  const points = fromStations.length > 0 ? fromStations : placed(codes);
  if (points.length === 0) return null;
  const mean = (pick: (p: GeoPoint) => number) =>
    points.reduce((sum, p) => sum + pick(p), 0) / points.length;
  return {
    lat: mean((p) => p.lat),
    lng: mean((p) => p.lon),
    altM: mean((p) => p.alt),
  };
}
