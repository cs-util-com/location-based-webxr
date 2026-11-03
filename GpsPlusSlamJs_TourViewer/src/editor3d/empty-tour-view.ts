/**
 * Where the editor on the globe opens a tour that has nothing with a
 * position yet (a new tour, or one of notes alone): the whole Earth,
 * looking straight down over the creator's own part of the world. The
 * longitude comes from the browser's time zone, the one hint a page has
 * without asking for the location; the latitude is a fixed northern one,
 * where most land lies. From there the creator flies down and places the
 * first station on the ground.
 *
 * Pure: no globe, no three.
 *
 * @see empty-tour-view.ts.md
 */

import type { GlobeViewPose } from "gps-plus-slam-globe/view";

/** The empty tour's view: its latitude and how far from straight down it
 *  looks (deg; straight down has no heading to keep). */
export const EMPTY_TOUR_VIEW = Object.freeze({
  lat: 30,
  pitchDeg: -89,
});

/** A longitude (deg) brought into -180..180 (180 itself reads as -180). */
function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/**
 * The empty tour's centre from the browser's time-zone offset
 * (`Date.prototype.getTimezoneOffset()`: minutes, positive WEST of
 * Greenwich): 15 degrees of longitude an hour, wrapped into -180..180, on
 * the ellipsoid. An offset that is not a finite number reads as Greenwich.
 */
export function emptyTourCentre(timezoneOffsetMin: number): {
  lat: number;
  lng: number;
  altM: number;
} {
  const lng = Number.isFinite(timezoneOffsetMin)
    ? wrapLng(-timezoneOffsetMin / 4)
    : 0;
  // `+ 0` turns a -0 (offset 0) into 0.
  return { lat: EMPTY_TOUR_VIEW.lat, lng: lng + 0, altM: 0 };
}

/**
 * The view down at `centre` from `altitudeKm` (the editor's approach
 * start height: the whole Earth in its lens). Throws a RangeError for a
 * place that is not finite or a height that is not a positive finite
 * number.
 */
export function emptyTourView(
  centre: { readonly lat: number; readonly lng: number },
  altitudeKm: number,
): GlobeViewPose {
  const { lat, lng } = centre;
  if (![lat, lng, altitudeKm].every(Number.isFinite) || !(altitudeKm > 0)) {
    throw new RangeError(
      `an empty tour's view needs a finite place and a positive height, got ${String(lat)},${String(lng)},${String(altitudeKm)}`,
    );
  }
  return {
    lat,
    lng,
    altitudeKm,
    headingDeg: 0,
    pitchDeg: EMPTY_TOUR_VIEW.pitchDeg,
  };
}
