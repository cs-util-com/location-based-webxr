/**
 * The approach's landing: the pin's flight down to a place, from the camera
 * as it is. The fixed dive (`dive`: turn and descend to `landKm` over
 * `diveMs`, never below the clearance over the target's ground) and the
 * continuous flight (`fly`, `aim`, `followGround`: `/globe/pin-flight.ts`,
 * landing `landAglM` above the place's ground, replanned as that ground is
 * read and as the relief revises it). Moved out of the globe lab's pin as a
 * pure refactor (editor-on-the-full-globe plan, the approach slice); the
 * pin's button, its phases and its lines stay in the lab.
 *
 * @see globe-landing-flight.ts.md
 */
import * as THREE from "three";
import type { Ellipsoid } from "3d-tiles-renderer";

import type { GlobeApproach } from "./globe-approach.js";
import { orbitPose, type OrbitPose } from "./globe-camera.js";
import { surfaceRadiusAlong } from "./globe-dive.js";
import { groundRevisionM } from "./landing-ground.js";
import {
  meteorLinkStart,
  pinFix,
  pinGround,
  pinProgress,
  pressPin,
} from "./pin-flight.js";
import type { LatLng } from "./globe-target.js";

/** The lab's knobs the landing reads. */
export interface LandingFlightParams {
  readonly landAglM: number;
  readonly meteorDeg: number;
  readonly paceLagMs: number;
  readonly paceStages: number;
  readonly landKm: number;
  readonly diveMs: number;
}

/** The camera's ECEF pose (`ecefPoseOf`): the world is not ECEF at a target. */
interface EcefPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/** A place's ground as the landing reads it, once per place. */
interface PlaceGround {
  readonly groundM: number | null;
  readonly source: string;
  readonly done: Promise<unknown>;
}

/**
 * The camera's current pose as an orbit pose: the direction from the
 * centre, and the screen's up made perpendicular to it (or, looking
 * straight along it, the view's forward direction, then north).
 */
function currentPose({ position, quaternion }: EcefPose): OrbitPose {
  const direction = position.clone().normalize();
  for (const axis of [
    new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion),
    new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion),
    new THREE.Vector3(0, 0, 1),
  ]) {
    const up = axis.addScaledVector(direction, -axis.dot(direction));
    if (up.lengthSq() > 1e-12) return { direction, up: up.normalize() };
  }
  return { direction, up: new THREE.Vector3(1, 0, 0) };
}

/**
 * The landing for `approach`. `ecefCamera()` returns a fresh copy of the
 * camera's ECEF pose; `placeCameraEcef` places it; `resetSpeed` restarts
 * the speed dust after a placement; `groundOf(place)` reads a place's
 * ground; `drawnGroundM` maps a true ground height to the drawn one;
 * `reliefGroundM(place)` is the relief's finest height there (or null);
 * `diveFloorM(place)` the dive's clearance floor. `now` is the page clock
 * (default `performance.now`).
 */
export function createGlobeLandingFlight({
  approach,
  ellipsoid,
  controls,
  ecefCamera,
  placeCameraEcef,
  resetSpeed,
  groundOf,
  drawnGroundM,
  reliefGroundM,
  diveFloorM,
  now = () => performance.now(),
}: {
  approach: Pick<
    GlobeApproach,
    "flyPin" | "aimPin" | "updatePin" | "dive" | "pinFlight"
  >;
  ellipsoid: Ellipsoid;
  controls: { release(): void };
  ecefCamera: () => EcefPose;
  placeCameraEcef: (
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
  ) => void;
  resetSpeed: () => void;
  groundOf: (place: LatLng) => PlaceGround;
  drawnGroundM: (groundM: number) => number;
  reliefGroundM: (place: LatLng) => number | null;
  diveFloorM: (place: LatLng) => number;
  now?: () => number;
}) {
  let located: LatLng | null = null;
  /** How often the relief revised the landing's ground, for the smokes. */
  let groundRevisions = 0;
  const drawnOrNull = (groundM: number | null) =>
    groundM === null ? null : drawnGroundM(groundM);

  /**
   * Out from `startPose` to `fromAltitudeM`, placed at once so no frame
   * shows the intro's camera first: on the meteor's line, looking along
   * it, for a link with a meteor (`meteorLinkStart`; the start returned),
   * else along the camera's own direction, its rotation kept (null).
   */
  const placeStart = (
    startPose: EcefPose,
    place: LatLng | null,
    params: LandingFlightParams,
    fromAltitudeM: number,
    groundM: number,
  ) => {
    let start: ReturnType<typeof meteorLinkStart> | null = null;
    if (place && params.meteorDeg < 90) {
      start = meteorLinkStart(
        ellipsoid,
        orbitPose(ellipsoid, place),
        startPose.position,
        fromAltitudeM,
        params.landAglM,
        params.meteorDeg,
        groundM,
      );
      startPose.position.copy(start.position);
      startPose.quaternion.copy(start.quaternion);
    } else {
      const direction = startPose.position.clone().normalize();
      startPose.position.copy(
        direction.multiplyScalar(
          surfaceRadiusAlong(ellipsoid, direction) + fromAltitudeM,
        ),
      );
    }
    placeCameraEcef(startPose.position, startPose.quaternion);
    // A placement, not a speed: the dust starts from rest.
    resetSpeed();
    return start;
  };

  /**
   * The place's ground, once read: the flight replans onto it if it still
   * flies to that place (`pinGround` ignores an unchanged ground).
   */
  const groundArrives = (place: LatLng) => {
    const ground = groundOf(place);
    void ground.done.then(() => {
      const same =
        located && located.lat === place.lat && located.lng === place.lng;
      if (!same || ground.groundM === null) return;
      const groundM = ground.groundM;
      approach.updatePin(now(), (p, t) =>
        pinGround(p, t, drawnGroundM(groundM)),
      );
    });
  };

  return {
    /** The flight's place once located, or null. */
    get located() {
      return located;
    },
    /** The flight's place is known: kept (a copy) and returned. */
    locate(place: LatLng): LatLng {
      located = { lat: place.lat, lng: place.lng };
      return located;
    },
    /**
     * The continuous flight from the camera as it is, to `place` if known
     * (a link), else held above the band until the fix. With
     * `fromAltitudeM` it starts out there instead.
     */
    fly(
      place: LatLng | null,
      params: LandingFlightParams,
      { fromAltitudeM = 0 }: { fromAltitudeM?: number } = {},
    ) {
      controls.release();
      const startPose = ecefCamera();
      // The place's ground, if already read (a link reads it from load):
      // the flight lands `landAglM` above it; else the ellipsoid until the
      // read arrives (`aim`).
      const groundM = place ? drawnGroundM(groundOf(place).groundM ?? 0) : 0;
      const flightStart =
        fromAltitudeM > 0
          ? placeStart(startPose, place, params, fromAltitudeM, groundM)
          : null;
      const at = now();
      approach.flyPin(
        at,
        pressPin(
          ellipsoid,
          at,
          flightStart ?? {
            pose: currentPose(startPose),
            distanceM: startPose.position.length(),
            quaternion: startPose.quaternion,
          },
          {
            target: place ? orbitPose(ellipsoid, place) : null,
            landingM: params.landAglM,
            groundM,
            progress: 0,
            meteorDeg: params.meteorDeg,
            paceLagMs: params.paceLagMs,
            paceStages: params.paceStages === 2 ? 2 : 1,
          },
        ),
        place,
      );
    },
    /**
     * The continuous flight's place is known (`locate` first): the readout
     * aims at it, the flight flies on to it, and its ground is read.
     */
    aim() {
      if (!located) return;
      const place = located;
      approach.aimPin(place);
      approach.updatePin(now(), (p, t) =>
        pinFix(p, t, orbitPose(ellipsoid, place)),
      );
      groundArrives(place);
    },
    /**
     * The fixed dive to the located place, from wherever the camera is,
     * on `clock` (the prefetch's): down to `landKm`, never closer to the
     * exaggerated ground under the target than its clearance.
     */
    dive(params: LandingFlightParams, clock: (elapsedMs: number) => number) {
      if (!located) return;
      const startPose = ecefCamera();
      approach.dive(
        now(),
        located,
        {
          pose: currentPose(startPose),
          distanceM: startPose.position.length(),
          quaternion: startPose.quaternion,
        },
        {
          durationMs: params.diveMs,
          toAltitudeM: Math.max(params.landKm * 1000, diveFloorM(located)),
          clock,
        },
      );
    },
    /**
     * Per frame of the continuous flight: its pace follows the data's
     * `progress()` (read only while a pin flight runs), and the landing's ground is revised by the relief's own
     * finest height at the place, past the margin and only while the
     * camera's height allows it (`groundRevisionM`, `pinGround`).
     */
    followGround(progress: () => number) {
      if (!located) return;
      const at = now();
      approach.updatePin(at, (p, t) => pinProgress(p, t, progress()));
      const pinNow = approach.pinFlight;
      const revised =
        pinNow &&
        groundRevisionM(pinNow.groundM, drawnOrNull(reliefGroundM(located)), {
          heightM:
            ellipsoid.getPositionElevation(ecefCamera().position) -
            pinNow.groundM,
        });
      if (revised !== null && revised !== undefined) {
        approach.updatePin(at, (p, t) => pinGround(p, t, revised));
        // Counted when taken (a raise the camera is too low for is not).
        if (approach.pinFlight?.groundM === revised) groundRevisions += 1;
      }
    },
    /** The continuous flight, for the smokes; null without one. */
    flightState() {
      const pin = approach.pinFlight;
      return (
        pin && {
          phase: pin.phase,
          clockMs: pin.clockMs,
          rate: pin.rate,
          landingM: pin.landingM,
          // The place's ground the flight lands above, m, how it was read,
          // and how often the relief revised it.
          groundM: pin.groundM,
          groundSource: located ? groundOf(located).source : null,
          groundRevisions,
          // The relief's own finest height at the place now (null: not loaded).
          reliefGroundM: located ? reliefGroundM(located) : null,
          meteorDeg: pin.meteorDeg,
          progress: pin.progress,
          gateClockMs: pin.gateClockMs,
          endsAtMs: pin.flight?.endsAtMs ?? null,
        }
      );
    },
  };
}
