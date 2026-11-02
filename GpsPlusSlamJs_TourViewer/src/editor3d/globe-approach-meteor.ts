/**
 * The editor's approach flight on opening a tour: the globe's own meteor
 * (the shared pin flight through `createGlobeApproach` and
 * `createGlobeLandingFlight`, one set of rules with the globe lab), from
 * high above down to close to the tour, on the editor's camera. It is the
 * `ApproachDriver` the approach's run (`globe-approach-run.ts`) drives.
 *
 * - One continuous trajectory: out on the meteor's line from the south at
 *   `startKm`, entering `meteorDeg` below the tour's horizon and landing
 *   at `meteorLandDeg`, `landAglM` over the tour's ground. The landing and
 *   its settle are the flight's own; the editor adds none.
 * - Paced by the tour's loading (`progress`, 0 to 1), as the lab's flight
 *   is by its city's: it waits before its final stretch until the tour is
 *   in, and lands without it after the flight's safety cap.
 * - It places the camera only (`placeCameraEcef`), never the view's frame:
 *   the frame follows the camera through the view's own recentring. A
 *   frame set from the camera's pose each frame made the old approach
 *   flicker.
 * - Reduced motion: a cut to the flight's end view, no flight.
 * - `retarget`: a new leg from the camera as it is, continuous in position,
 *   direction and speed.
 * - `durationMs` (the page's checks only) runs the flight on a scaled
 *   clock, so it lasts that long at a full pace.
 *
 * @see globe-approach-meteor.ts.md
 */
import * as THREE from "three";
import {
  PIN_FLIGHT,
  createApproachDrive,
  createFovReturn,
  createGlobeApproach,
  createGlobeLandingFlight,
  pinEnd,
  type GlobeView,
} from "gps-plus-slam-globe/view";

import type { ApproachDriver } from "./globe-approach-run.js";

const DEG = Math.PI / 180;

/** The meteor's knobs (the link's, `globe-switch.ts`). */
export interface MeteorKnobs {
  /** The angle it enters at, below the tour's horizon (deg). */
  readonly meteorDeg: number;
  /** The angle it lands at, held over the final stretch (deg). */
  readonly meteorLandDeg: number;
  /** The landing's height over the tour's ground (m). */
  readonly landAglM: number;
  /** The start height (km over the ellipsoid). */
  readonly startKm: number;
}

/** A place, degrees. */
interface Place {
  readonly lat: number;
  readonly lng: number;
}

/** The meteor comes from this far south of the tour (deg): it looks
 *  north, at the sunlit side of what it flies to in the northern half. */
const FROM_SOUTH_DEG = 30;

/** The globe view as the flight uses it: its camera, never its frame. */
type MeteorView = Pick<
  GlobeView,
  "camera" | "ecefCamera" | "placeCameraEcef" | "fitDistance"
>;

type Ellipsoid = Parameters<typeof createGlobeApproach>[0];

/** A ground height the flight accepts: finite and not below the ellipsoid. */
const groundOf = (m: number | null): number =>
  m !== null && Number.isFinite(m) ? Math.max(0, m) : 0;

/**
 * The meteor approach to `tour` (its ground `groundM`, m over the
 * ellipsoid) on `view`'s camera, placed out on its line at once. `progress`
 * is the tour's loading (0 to 1), `reliefGroundM` the relief's finest
 * height at a place (null where none is loaded; the landing follows it).
 * `now` is the page clock (default `performance.now`).
 */
export function createMeteorApproach(deps: {
  readonly ellipsoid: Ellipsoid;
  readonly view: MeteorView;
  readonly controls: { release(): void };
  readonly tour: Place;
  readonly groundM: number;
  readonly knobs: MeteorKnobs;
  readonly progress: () => number;
  readonly reliefGroundM: (place: Place) => number | null;
  readonly reducedMotion: boolean;
  readonly durationMs?: number;
  readonly now?: () => number;
}): ApproachDriver {
  const { ellipsoid, view, knobs, tour } = deps;
  const pageNow = deps.now ?? (() => performance.now());
  const groundM = groundOf(deps.groundM);
  /** When the first frame was drawn (page ms), null before. */
  let startedAt: number | null = null;
  /** The flight's time per page ms (1 unless the checks set a length). */
  let scale = 1;
  /** The flight's clock: 0 until the first frame. */
  const clock = () =>
    startedAt === null ? 0 : (pageNow() - startedAt) * scale;
  const fovY = view.camera.fov;
  const placeCameraEcef = (p: THREE.Vector3, q: THREE.Quaternion) => {
    view.placeCameraEcef(p, q);
  };

  const approach = createGlobeApproach(ellipsoid, {
    // The intro is never flown here (the flight starts at once): its sun,
    // fit and zoom-out are only read by the intro's spin and fly-in.
    sunEcef: () => new THREE.Vector3(1, 0, 0),
    fitDistance: () => view.fitDistance(),
    zoomOutM: () => knobs.startKm * 1000,
    now: clock,
  });
  approach.restart(0, {
    url: tour,
    spinMs: 0,
    turnMs: 0,
    intro: "distance",
    maxKm: knobs.startKm,
    turnCap: 0,
    fovY,
    pitchLow: 0,
  });
  const drive = createApproachDrive({
    approach,
    camera: view.camera,
    fovReturn: createFovReturn(view.camera, () => fovY),
    placeCameraEcef,
    fitDistance: () => view.fitDistance(),
  });
  const landing = createGlobeLandingFlight({
    approach,
    ellipsoid,
    controls: deps.controls,
    ecefCamera: () => view.ecefCamera(),
    placeCameraEcef,
    resetSpeed: () => undefined,
    groundOf: () => ({
      groundM,
      source: "tour",
      done: Promise.resolve(),
    }),
    drawnGroundM: (m) => m,
    reliefGroundM: (place) => {
      const m = deps.reliefGroundM(place);
      return m === null ? null : groundOf(m);
    },
    diveFloorM: () => 0,
    now: clock,
  });
  const progress = () => {
    const p = deps.progress();
    return Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;
  };

  // Out on the meteor's line from the south, before the first frame.
  const fromLatDeg = Math.max(-89, tour.lat - FROM_SOUTH_DEG);
  view.placeCameraEcef(
    ellipsoid.getCartographicToPosition(
      fromLatDeg * DEG,
      tour.lng * DEG,
      knobs.startKm * 1000,
      new THREE.Vector3(),
    ),
    new THREE.Quaternion(),
  );
  landing.locate(tour);
  landing.fly(
    tour,
    {
      landAglM: knobs.landAglM,
      meteorDeg: knobs.meteorDeg,
      meteorLandDeg: knobs.meteorLandDeg,
      paceLagMs: PIN_FLIGHT.rateLagMs,
      paceStages: 1,
      // The fixed dive's, unused by the continuous flight.
      landKm: knobs.landAglM / 1000,
      diveMs: 0,
    },
    { fromAltitudeM: knobs.startKm * 1000 },
  );
  /** The path's own length at a full pace (ms). */
  const naturalMs = approach.pinFlight?.flight?.path.durationMs ?? 0;
  if (deps.durationMs !== undefined && deps.durationMs > 0 && naturalMs > 0) {
    scale = naturalMs / deps.durationMs;
  }
  /** Whether reduced motion cut to the end, or the creator took the
   *  camera: the flight places it no more. */
  let cut = false;
  const endAglM = knobs.landAglM;
  const topAglM = Math.max(knobs.startKm * 1000 - groundM, endAglM * 1.0001);

  return {
    durationMs: deps.reducedMotion ? 0 : (deps.durationMs ?? naturalMs),
    start(nowMs) {
      startedAt ??= nowMs;
      if (!deps.reducedMotion || cut) return;
      cut = true;
      // The end of the flight as it would fly with the tour in.
      landing.followGround(() => 1);
      const end = approach.pinFlight && pinEnd(approach.pinFlight);
      if (end) placeCameraEcef(end.position, end.quaternion);
      approach.yieldToUser(clock());
    },
    drive() {
      if (cut) return false;
      landing.followGround(progress);
      drive(clock());
      return approach.pinFlight?.phase !== "landed";
    },
    retarget(place, toGroundM) {
      landing.retarget(place, groundOf(toGroundM));
    },
    takeOver() {
      cut = true;
      approach.yieldToUser(clock());
    },
    bar(altitudeKm) {
      const h = altitudeKm * 1000 - groundM;
      if (!Number.isFinite(h)) return 0;
      const k =
        1 -
        Math.log(Math.max(h, endAglM) / endAglM) / Math.log(topAglM / endAglM);
      return Math.min(1, Math.max(0, k));
    },
  };
}
