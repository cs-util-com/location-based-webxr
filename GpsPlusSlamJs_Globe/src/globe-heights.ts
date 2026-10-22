/**
 * Heights between a GPS fix and the globe's drawn ground (tour editor plan
 * 2026-10-17-1816 §13, "Heights"; G0 spikes Q1): the globe draws the
 * relief's ORTHOMETRIC heights over the ellipsoid, a phone's GPS altitude
 * is ELLIPSOIDAL, and the two differ by the geoid's undulation N (about
 * 46-50 m in central Europe). Pure.
 *
 * The geoid is passed in, not imported: the Osm library's `egm96Geoid()`
 * (`gps-plus-slam-osm/elevation`) is what an app passes; the globe package
 * does not depend on that library, and its shape is the library's
 * `GeoidModel`, so the library's model fits as it is.
 *
 * @see globe-heights.ts.md
 */

/** A place in degrees (the Osm library's `LatLng`). */
export interface GlobeHeightPlace {
  readonly lat: number;
  readonly lng: number;
}

/** The Osm library's `GeoidModel`, structurally: N in metres at a place. */
export interface GlobeGeoid {
  readonly id: string;
  undulationMetres(position: GlobeHeightPlace): number;
}

/** RangeError unless a latitude in [-90, 90] and a finite longitude. */
function checkPlace(at: GlobeHeightPlace): void {
  if (
    !(Number.isFinite(at?.lat) && Math.abs(at.lat) <= 90) ||
    !Number.isFinite(at?.lng)
  ) {
    throw new RangeError(
      `a place needs a latitude in [-90, 90] and a finite longitude, got ${at?.lat}, ${at?.lng}`,
    );
  }
}

/** N at `at`, every input checked (RangeError on anything non-finite). */
function undulationAt(
  heightM: number,
  at: GlobeHeightPlace,
  geoid: GlobeGeoid,
  offsetM: number,
): number {
  if (!Number.isFinite(heightM)) {
    throw new RangeError(`a height must be finite, got ${heightM}`);
  }
  checkPlace(at);
  if (!Number.isFinite(offsetM)) {
    throw new RangeError(`the vertical offset must be finite, got ${offsetM}`);
  }
  const n = geoid.undulationMetres({ lat: at.lat, lng: at.lng });
  if (!Number.isFinite(n)) {
    throw new RangeError(
      `the geoid ${geoid.id} answered ${n} at ${at.lat}, ${at.lng}`,
    );
  }
  return n;
}

/**
 * The height (m over the ellipsoid, in the globe's frame) at which an
 * ELLIPSOIDAL height `ellipsoidalM` at `at` is drawn: the orthometric
 * height (ellipsoidal minus N) plus the scene's vertical `offsetM` (a
 * tour's calibration; 0 by default). RangeError for a non-finite height,
 * place, offset or undulation.
 */
export function drawnHeightM(
  ellipsoidalM: number,
  at: GlobeHeightPlace,
  geoid: GlobeGeoid,
  offsetM = 0,
): number {
  return (
    ellipsoidalM - undulationAt(ellipsoidalM, at, geoid, offsetM) + offsetM
  );
}

/**
 * The inverse of `drawnHeightM`: the ellipsoidal height of a point drawn
 * at `drawnM` (what a moved item saves to a tour file). Same refusals.
 */
export function ellipsoidalHeightM(
  drawnM: number,
  at: GlobeHeightPlace,
  geoid: GlobeGeoid,
  offsetM = 0,
): number {
  return drawnM + undulationAt(drawnM, at, geoid, offsetM) - offsetM;
}
