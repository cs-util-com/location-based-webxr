/**
 * The desktop preview's geo↔world frame — the preview's counterpart to the
 * live session's alignment matrix.
 *
 * On a phone the frame comes from GPS+VIO alignment; on a desktop there is no
 * alignment to converge, so the preview pins it: the tour's own origin becomes
 * the GPS zero reference and the alignment is the identity, which makes the
 * scene's world frame exactly GPS-world NUE (`x = north`, `y = up`,
 * `z = east`). That is the one place the preview may talk in lat/lon — the
 * same single geo→world step §2.5.1 permits — and it is expressed through the
 * framework's own primitives rather than hand-rolled haversine math.
 *
 * Pure: metres in, metres out, no Three.js and no DOM.
 */

import {
  calcGpsCoords,
  calcRelativeCoordsInMeters,
} from "gps-plus-slam-app-framework/core";

import type { TourCoord } from "../../../store/types.js";

/** A position in the preview's world frame, in metres. */
interface PreviewPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PreviewFrame {
  /** Where a tour coordinate sits in the preview's world. */
  toWorld(coord: TourCoord): PreviewPoint;
  /** The coordinate a world position corresponds to (for the 2D map). */
  toCoord(point: PreviewPoint): { lat: number; lon: number };
  /** The GPS zero reference this frame is pinned to. */
  readonly origin: { readonly lat: number; readonly lon: number };
}

export function createPreviewFrame(origin: {
  lat: number;
  lon: number;
}): PreviewFrame {
  return {
    origin,
    toWorld(coord) {
      // Altitude is persisted but not yet consumed (contract D6) — every
      // point sits on the floor plane regardless of its recorded GPS
      // altitude, which is too noisy to place objects with.
      const nue = calcRelativeCoordsInMeters(origin, coord, 0, 0);
      return { x: nue[0], y: nue[1], z: nue[2] };
    },
    toCoord(point) {
      const gps = calcGpsCoords(origin, [point.x, point.y, point.z]);
      return { lat: gps.lat, lon: gps.lon };
    },
  };
}
