/**
 * The editor on the globe view, its look and its per-frame rules, kept
 * pure (no WebGL): the view's settings, the first view at street level,
 * which carrier draws the ground at an altitude, and which objects the
 * visibility rules (`globe-visibility.ts`) hide this frame.
 *
 * @see globe-editor-look.ts.md
 */
import * as THREE from "three";

import { GLOBE_EYE, type EcefPose } from "gps-plus-slam-globe/editor";
import {
  GLOBE_CLOUD_DRIFT_DEG_PER_S,
  GLOBE_CLOUD_DRIFT_LAW,
  type GlobeViewPose,
  type GlobeViewSettings,
} from "gps-plus-slam-globe/view";

import { crowdedPins, screenSizePx, sizeShown } from "./globe-visibility.js";

/** Metres per degree of latitude (the mean; for the stand-back only). */
const M_PER_DEG_LAT = 111_320;
const DEG = Math.PI / 180;

export const GLOBE_EDITOR_LOOK = Object.freeze({
  /** The view's vertical lens (deg): the OrbitControls editor's 50. */
  fovYDeg: 50,
  /** The first view stands this far south of the tour's centre (m). */
  backM: 30,
  /** And this high over the ground there (m): the globe's eye height. */
  eyeM: GLOBE_EYE.clearanceM,
  /**
   * Under this altitude (m over the ellipsoid) the relief carries the
   * ground, over it the globe's surface; a carrier changes only once the
   * camera is `reliefBandM` past the line. Declared, not measured: the
   * relief's map fades out by 2.4 km over the ground and the globe's
   * imagery reads from orbit, so any line between is a look to be tuned
   * on screen.
   */
  reliefCeilingM: 25_000,
  reliefBandM: 5_000,
  /** A flight to an object (and Frame) looks down at it at this pitch
   *  (deg), from `aimRadii` times its radius away, `backM` at least. */
  aimPitchDeg: -30,
  aimRadii: 3,
});

const SETTINGS: GlobeViewSettings = Object.freeze({
  fovY: GLOBE_EDITOR_LOOK.fovYDeg,
  // The frame follows the target: the tour is drawn near the origin.
  worldFrame: 1,
  sky: 1,
  // The lab's default navy.
  space: 0.1,
  holeColor: 0,
  cloudDrift: GLOBE_CLOUD_DRIFT_DEG_PER_S,
  cloudDriftFarKm: GLOBE_CLOUD_DRIFT_LAW.farM / 1000,
  cloudWindMps: GLOBE_CLOUD_DRIFT_LAW.windMps,
});

/** The view's settings (the same object every call: the view reads them
 *  each frame). */
export function globeEditorSettings(): GlobeViewSettings {
  return SETTINGS;
}

/**
 * The first view: `backM` south of `centre`, `eyeM` over `groundM` (m over
 * the ellipsoid), facing north and down at the centre's ground. RangeError
 * for a value that is not finite.
 */
export function streetView(
  centre: { readonly lat: number; readonly lng: number },
  groundM: number,
): GlobeViewPose {
  const { lat, lng } = centre;
  if (![lat, lng, groundM].every(Number.isFinite)) {
    throw new RangeError(
      `a street view needs a finite place and ground, got ${String(lat)},${String(lng)},${String(groundM)}`,
    );
  }
  const { backM, eyeM } = GLOBE_EDITOR_LOOK;
  return {
    lat: lat - backM / M_PER_DEG_LAT,
    lng,
    altitudeKm: (groundM + eyeM) / 1000,
    headingDeg: 0,
    pitchDeg: -Math.atan2(eyeM, backM) / DEG,
  };
}

/**
 * Whether the relief carries the ground at `altitudeM` (over the
 * ellipsoid), given whether it did last frame: below the ceiling less the
 * band it takes over, from the ceiling plus the band it gives up, between
 * nothing changes. An altitude that is not a number changes nothing.
 */
export function reliefCarries(altitudeM: number, wasRelief: boolean): boolean {
  if (Number.isNaN(altitudeM)) return wasRelief;
  const { reliefCeilingM: ceiling, reliefBandM: band } = GLOBE_EDITOR_LOOK;
  return wasRelief ? altitudeM < ceiling + band : altitudeM < ceiling - band;
}

/** One object of the tour as the camera sees it this frame. */
export interface GlobeObjectOnScreen {
  readonly id: string;
  readonly kind: "station" | "code";
  /** Its size: a station's found radius, half a code's printed side (m). */
  readonly radiusM: number;
  readonly distanceM: number;
  /** Where it lands on the canvas (CSS px), null behind the camera. */
  readonly screen: { readonly x: number; readonly y: number } | null;
}

/** What the rules hide (station ids, code level ids). */
export interface GlobeHiddenSet {
  readonly stations: ReadonlySet<string>;
  readonly codes: ReadonlySet<string>;
}

/**
 * This frame's hidden objects, from last frame's (`was`, for the rules'
 * hysteresis): each object by its own size on screen (`sizeShown`), then
 * the stations still drawn by crowding (`crowdedPins`; one hidden by size
 * is no one's neighbour). The `selected` station never hides. Objects
 * behind the camera are judged by size alone. RangeError from the rules
 * for a knob out of range.
 */
export function globeHidden(
  objects: readonly GlobeObjectOnScreen[],
  was: GlobeHiddenSet,
  knobs: {
    readonly hidePx: number;
    readonly crowdPx: number;
    readonly fovYDeg: number;
    readonly viewportPx: number;
  },
  selected: string | null,
): GlobeHiddenSet {
  const stations = new Set<string>();
  const codes = new Set<string>();
  const pins: { id: string; x: number; y: number }[] = [];
  const hiddenBefore = new Set<string>();
  for (const o of objects) {
    const isStation = o.kind === "station";
    const before = isStation ? was.stations : was.codes;
    const px = screenSizePx({
      radiusM: o.radiusM,
      distanceM: o.distanceM,
      fovYDeg: knobs.fovYDeg,
      viewportHeightPx: knobs.viewportPx,
    });
    const keep =
      (isStation && o.id === selected) ||
      sizeShown(!before.has(o.id), px, knobs.hidePx);
    if (!keep) {
      (isStation ? stations : codes).add(o.id);
      continue;
    }
    if (isStation && o.screen !== null) {
      pins.push({ id: o.id, x: o.screen.x, y: o.screen.y });
      if (before.has(o.id)) hiddenBefore.add(o.id);
    }
  }
  for (const id of crowdedPins(pins, knobs.crowdPx, hiddenBefore, selected)) {
    stations.add(id);
  }
  return { stations, codes };
}

/**
 * A view looking down at `place` (its height `heightM` over the
 * ellipsoid) from the south at `aimPitchDeg`, `aimRadii` x `radiusM` away
 * along the line of sight (`backM` at least). RangeError for a value that
 * is not finite or a negative radius.
 */
export function aimView(
  place: { readonly lat: number; readonly lng: number },
  heightM: number,
  radiusM: number,
): GlobeViewPose {
  const { lat, lng } = place;
  if (![lat, lng, heightM, radiusM].every(Number.isFinite) || radiusM < 0) {
    throw new RangeError(
      `an aimed view needs a finite place, height and radius >= 0, got ${String(lat)},${String(lng)},${String(heightM)},${String(radiusM)}`,
    );
  }
  const { aimPitchDeg, aimRadii, backM } = GLOBE_EDITOR_LOOK;
  const distanceM = Math.max(backM, aimRadii * radiusM);
  const down = -aimPitchDeg * DEG;
  return {
    lat: lat - (distanceM * Math.cos(down)) / M_PER_DEG_LAT,
    lng,
    altitudeKm: (heightM + distanceM * Math.sin(down)) / 1000,
    headingDeg: 0,
    pitchDeg: aimPitchDeg,
  };
}

/** What `viewPoseOf` needs of an ellipsoid (the tile renderer's). */
interface PoseEllipsoid {
  getPositionToCartographic(
    position: THREE.Vector3,
    target: { lat: number; lon: number; height: number },
  ): { lat: number; lon: number; height: number };
  getEastNorthUpAxes(
    lat: number,
    lon: number,
    east: THREE.Vector3,
    north: THREE.Vector3,
    up: THREE.Vector3,
  ): void;
}

const east = new THREE.Vector3();
const north = new THREE.Vector3();
const up = new THREE.Vector3();
const forward = new THREE.Vector3();

/**
 * The view a camera at an ECEF pose shows (`viewPoseEcef`'s inverse): its
 * place and altitude, the heading its line of sight points toward (deg
 * from north toward east, in [0, 360)) and its pitch above the local
 * horizontal. Straight down the heading is 0.
 */
export function viewPoseOf(
  ellipsoid: PoseEllipsoid,
  pose: EcefPose,
): GlobeViewPose {
  const at = ellipsoid.getPositionToCartographic(pose.position, {
    lat: 0,
    lon: 0,
    height: 0,
  });
  ellipsoid.getEastNorthUpAxes(at.lat, at.lon, east, north, up);
  forward.set(0, 0, -1).applyQuaternion(pose.quaternion);
  const pitch = Math.asin(Math.min(1, Math.max(-1, forward.dot(up))));
  const flatE = forward.dot(east);
  const flatN = forward.dot(north);
  const heading =
    Math.hypot(flatE, flatN) < 1e-9 ? 0 : Math.atan2(flatE, flatN) / DEG;
  return {
    lat: at.lat / DEG,
    lng: at.lon / DEG,
    altitudeKm: at.height / 1000,
    headingDeg: ((heading % 360) + 360) % 360,
    pitchDeg: pitch / DEG,
  };
}
