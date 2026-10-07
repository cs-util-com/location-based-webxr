/**
 * The pin's continuous flight (continuous-flight plan 2026-10-07-0941,
 * CF1): from wherever the camera is to `landingM` above the target, as
 * one movement that never stops in between. Pure: time in; the camera's
 * view centre, altitude, pitch and up (`flightAt`), or its position and
 * rotation (`flightCamera`), out.
 *
 * THE PATH is van Wijk and Nuij's smooth zoom-and-pan ("Smooth and
 * efficient zooming and panning", InfoVis 2003; d3's `interpolateZoom`)
 * with rho = 1: in (ground distance u, altitude h) it is a geodesic of
 * the metric ds^2 = (du^2 + dh^2) / h^2, the same measure the flight is
 * judged by (the cold review's v = sqrt((d ln h/dt)^2 + (ground speed /
 * h)^2)). Travelled at a constant ds/dt it has a constant speed by that
 * measure, so it cannot stop or surge in between. A start high above the
 * target only descends; a start low and far away climbs first (the
 * geodesic's arch), so it never slides over the ground; near the end the
 * remaining ground distance shrinks with the square of the altitude.
 *
 * THE CLOCK is the one exception to the constant speed: a ramp from the
 * start's speed over `rampMs`, and one settle over the last ln(3) of the
 * path (from about 3 x the landing down), each a smoothstep in the speed.
 *
 * THE VIEW: the camera looks at the view's centre, which travels the
 * great circle to the target, from `descentPitchDeg` below its horizontal
 * and from behind along its course (DEC-CF-2; cold review finding 2:
 * `obliqueCamera` places the camera along -up, so up is the course). The
 * start's own pitch, roll and tilt are blended out over the first fifth,
 * so the press never snaps the view.
 *
 * @see flight-path.ts.md
 */

import * as THREE from "three";
import type { Ellipsoid } from "3d-tiles-renderer";

import type { OrbitPose } from "./globe-camera.js";
import { smoothstep } from "./globe-ease.js";
import {
  obliqueCamera,
  orbitQuaternion,
  surfaceRadiusAlong,
} from "./globe-dive.js";

export const FLIGHT_PATH = Object.freeze({
  /** The flight on its own clock (today's dive's 15 s). */
  durationMs: 15_000,
  /** DEC-CF-2: the view's depression through the atmosphere, 20-25. */
  entryPitchDeg: 22.5,
  /** ...and at the landing. */
  landingPitchDeg: 45,
  /** Above this the view looks at the Earth's centre (as `pitchAtDeg`). */
  orbitM: 5_000_000,
  /** By this the view has eased to the entry pitch. */
  entryM: 100_000,
  /** From this many landings up the view steepens to the landing pitch. */
  landingBand: 5,
  /**
   * The bound on the remaining ground distance over the height above the
   * landing below the arch (the cold review's k): the geodesic keeps it
   * under 1 on its descending side; 2 leaves room for the sphere.
   */
  arcPerAltitude: 2,
  /** The speed's ramp from the start's, ms (at most a quarter of the flight). */
  rampMs: 800,
  /** The settle covers the path's last ln(this) (about 3 x the landing down). */
  settleFactor: 3,
  /** The share of the flight over which the start's own view blends out. */
  startBlendShare: 0.2,
  /** The least the view looks below the horizon, degrees (as `pitchAtDeg`). */
  horizonMarginDeg: 5,
  /** The width of the smooth maximum with the horizon floor, degrees. */
  floorBlendDeg: 2,
  /** The mean radius the ground distance and the horizon are taken on. */
  radiusM: 6_371_000,
});

const DEG = Math.PI / 180;

/** How far `altM` lies from `far` down to `near`, 0-1, in the logarithm. */
const logShare = (altM: number, far: number, near: number): number =>
  (Math.log(far) - Math.log(Math.max(altM, 1))) /
  (Math.log(far) - Math.log(near));

/** max(a, b), rounded over `w` so it has no kink; exact outside it. */
function smoothMax(a: number, b: number, w: number): number {
  const d = a - b;
  if (Math.abs(d) >= w) return Math.max(a, b);
  return (a + b) / 2 + (d * d) / (4 * w) + w / 4;
}

function requirePositive(name: string, value: number): void {
  if (!(value > 0 && Number.isFinite(value))) {
    throw new RangeError(`${name} must be a positive number, got ${value}`);
  }
}

/**
 * The view's depression below the local horizontal at `altM` (DEC-CF-2):
 * 90 degrees (the Earth's centre) above `orbitM`, easing to the entry
 * pitch by `entryM`, which holds down to `landingBand` x the landing, then
 * steepening to the landing pitch at the landing; each band a smoothstep
 * in the altitude's logarithm. Never less than `horizonMarginDeg` below
 * the horizon (a smooth maximum, so no kink). The landing pitch is exact
 * for landings up to `entryM`. RangeError for a non-finite altitude or a
 * landing that is not a positive number.
 */
export function descentPitchDeg(
  altM: number,
  options: {
    readonly landingM: number;
    readonly entryDeg?: number;
    readonly landingDeg?: number;
  },
): number {
  const {
    landingM,
    entryDeg = FLIGHT_PATH.entryPitchDeg,
    landingDeg = FLIGHT_PATH.landingPitchDeg,
  } = options;
  if (!Number.isFinite(altM)) {
    throw new RangeError(`the altitude must be finite, got ${altM}`);
  }
  requirePositive("landingM", landingM);
  const toEntry = smoothstep(
    logShare(altM, FLIGHT_PATH.orbitM, FLIGHT_PATH.entryM),
  );
  const toLanding = smoothstep(
    logShare(altM, FLIGHT_PATH.landingBand * landingM, landingM),
  );
  const law =
    90 + (entryDeg - 90) * toEntry + (landingDeg - entryDeg) * toLanding;
  const r = FLIGHT_PATH.radiusM;
  const dip = Math.acos(r / (r + Math.max(0, altM))) / DEG;
  return Math.min(
    90,
    smoothMax(
      law,
      dip + FLIGHT_PATH.horizonMarginDeg,
      FLIGHT_PATH.floorBlendDeg,
    ),
  );
}

/** Where the camera is when a flight begins (as `DiveStart`). */
export interface FlightStart {
  /** Its orbit pose: the direction from the centre and the screen's up. */
  readonly pose: OrbitPose;
  /** Its distance from the centre, metres. */
  readonly distanceM: number;
  /** Its rotation (the controls may have tilted it off the orbit view). */
  readonly quaternion?: THREE.Quaternion;
}

/** A planned flight, for `flightAt` and `flightCamera`. */
export interface FlightPath {
  readonly ellipsoid: Ellipsoid;
  readonly durationMs: number;
  readonly landingM: number;
  readonly entryPitchDeg: number;
  readonly landingPitchDeg: number;
  /** The view's centre at the start, a unit vector. */
  readonly startCentre: THREE.Vector3;
  /** The target's direction, a unit vector. */
  readonly target: THREE.Vector3;
  /** The great circle's normal (null when the start is over the target). */
  readonly normal: THREE.Vector3 | null;
  /** The angle from the start's centre to the target, radians. */
  readonly arcRad: number;
  /** The start's screen up and its rotation relative to its orbit view. */
  readonly startUp: THREE.Vector3;
  readonly startOffset: THREE.Quaternion;
  /** The geodesic and its clock. */
  readonly geodesic: Geodesic;
  readonly clock: Clock;
}

/**
 * A geodesic of ds^2 = (du^2 + dh^2) / h^2 from (0, h0) to (d, h1),
 * parameterised by its arc length s in [0, length]: u as a share of d.
 */
interface Geodesic {
  readonly length: number;
  readonly at: (s: number) => { readonly share: number; readonly h: number };
}

/**
 * Below this share of the lower altitude the ground distance is a pure
 * zoom: van Wijk's terms grow as 1/d and cancel (a press right above the
 * target gave NaN altitudes), and a millimetre per metre is not visible.
 */
const PURE_ZOOM_SHARE = 1e-3;

function geodesic(h0: number, h1: number, d: number): Geodesic {
  if (!(d > PURE_ZOOM_SHARE * Math.min(h0, h1))) {
    const length = Math.abs(Math.log(h1 / h0));
    return {
      length,
      at: (s) => ({
        share: length > 0 ? s / length : 1,
        h: h0 * (h1 / h0) ** (length > 0 ? s / length : 1),
      }),
    };
  }
  // van Wijk and Nuij with rho = 1 (d3's interpolateZoom), whose
  // r = ln(sqrt(b^2 + 1) - b) is written as -asinh(b): the same value
  // without the cancellation for a large b.
  const b0 = (h1 * h1 - h0 * h0 + d * d) / (2 * h0 * d);
  const b1 = (h1 * h1 - h0 * h0 - d * d) / (2 * h1 * d);
  const r0 = -Math.asinh(b0);
  const r1 = -Math.asinh(b1);
  const coshR0 = Math.cosh(r0);
  return {
    length: r1 - r0,
    at: (s) => ({
      share: (h0 / d) * (coshR0 * Math.tanh(s + r0) - Math.sinh(r0)),
      h: (h0 * coshR0) / Math.cosh(s + r0),
    }),
  };
}

/** The clock: path length travelled by `t`, from a ramp, a cruise and a settle. */
interface Clock {
  readonly at: (tMs: number) => number;
}

function flightClock(
  length: number,
  durationMs: number,
  startSpeed: number,
): Clock {
  const ramp = Math.min(FLIGHT_PATH.rampMs, durationMs / 4);
  const settle = Math.min(Math.log(FLIGHT_PATH.settleFactor), length / 3);
  // The cruise speed that ends the path at the duration (see the md).
  const v =
    (length + settle - (startSpeed * ramp) / 2) / (durationMs - ramp / 2);
  const settleMs = settle > 0 && v > 0 ? (2 * settle) / v : 0;
  const cruiseMs = durationMs - ramp - settleMs;
  const rampLength = (ramp * (startSpeed + v)) / 2;
  if (!(v > 0) || cruiseMs < 0 || rampLength + settle > length) {
    // Too short a path for a cruise: one smoothstep over the whole flight.
    return { at: (t) => length * smoothstep(t / durationMs) };
  }
  const integral = (x: number) => x ** 3 - x ** 4 / 2; // of smoothstep, 0..x
  return {
    at: (t) => {
      if (t <= 0) return 0;
      if (t < ramp) {
        const x = t / ramp;
        return ramp * (startSpeed * x + (v - startSpeed) * integral(x));
      }
      if (t < ramp + cruiseMs) return rampLength + v * (t - ramp);
      if (t >= durationMs) return length;
      const x = (t - ramp - cruiseMs) / settleMs;
      return length - settle + v * settleMs * (x - integral(x));
    },
  };
}

/**
 * A flight from `start` to `landingM` above `target`'s surface point. The
 * start's altitude is its own height above the surface along its own
 * direction. `startSpeed` is the path's speed at the press (path length
 * per ms; 0, the default, starts from rest). RangeError for a landing or
 * a duration that is not a positive number, or a negative start speed.
 */
export function planFlight(
  ellipsoid: Ellipsoid,
  start: FlightStart,
  target: OrbitPose,
  options: {
    readonly landingM: number;
    readonly durationMs?: number;
    readonly entryPitchDeg?: number;
    readonly landingPitchDeg?: number;
    readonly startSpeed?: number;
  },
): FlightPath {
  const durationMs = options.durationMs ?? FLIGHT_PATH.durationMs;
  requirePositive("landingM", options.landingM);
  requirePositive("durationMs", durationMs);
  const startSpeed = options.startSpeed ?? 0;
  if (!(startSpeed >= 0 && Number.isFinite(startSpeed))) {
    throw new RangeError(`startSpeed must be 0 or more, got ${startSpeed}`);
  }
  const startCentre = start.pose.direction.clone().normalize();
  const to = target.direction.clone().normalize();
  const cross = new THREE.Vector3().crossVectors(startCentre, to);
  const arcRad = Math.atan2(cross.length(), startCentre.dot(to));
  let normal: THREE.Vector3 | null = null;
  if (cross.length() > 1e-9) normal = cross.normalize();
  else if (arcRad > 1) {
    // Antipodes: over the start's up, as `turnPose` does.
    normal = new THREE.Vector3()
      .crossVectors(startCentre, start.pose.up)
      .normalize();
  }
  const h0 = Math.max(
    1,
    start.distanceM - surfaceRadiusAlong(ellipsoid, startCentre),
  );
  const path = geodesic(h0, options.landingM, arcRad * FLIGHT_PATH.radiusM);
  const orbit = orbitQuaternion(start.pose, new THREE.Quaternion());
  return {
    ellipsoid,
    durationMs,
    landingM: options.landingM,
    entryPitchDeg: options.entryPitchDeg ?? FLIGHT_PATH.entryPitchDeg,
    landingPitchDeg: options.landingPitchDeg ?? FLIGHT_PATH.landingPitchDeg,
    startCentre,
    target: to,
    normal,
    arcRad,
    startUp: start.pose.up.clone(),
    startOffset: start.quaternion
      ? orbit.invert().multiply(start.quaternion)
      : new THREE.Quaternion(),
    geodesic: path,
    clock: flightClock(path.length, durationMs, startSpeed),
  };
}

/** One instant of a flight. */
export interface FlightFrame {
  /** The view's centre, a unit vector on the great circle to the target. */
  readonly centre: THREE.Vector3;
  /** The screen's up: the course, blended from the start's up. */
  readonly up: THREE.Vector3;
  /** The camera's height above the surface along the centre, metres. */
  readonly altitudeM: number;
  /** The angle still to go to the target, radians. */
  readonly arcRad: number;
  /** The view's depression, degrees. */
  readonly pitchDeg: number;
  /** The start's own view's remaining weight, 1 at the press to 0. */
  readonly startWeight: number;
  readonly done: boolean;
}

/** The flight `tMs` after the press; the ends are exact and held. */
export function flightAt(path: FlightPath, tMs: number): FlightFrame {
  const done = tMs >= path.durationMs;
  const s = done ? path.geodesic.length : path.clock.at(Math.max(0, tMs));
  const point = done
    ? { share: 1, h: path.landingM }
    : tMs <= 0
      ? { share: 0, h: path.geodesic.at(0).h }
      : path.geodesic.at(s);
  const share = Math.min(Math.max(point.share, 0), 1);
  const turned = path.arcRad * share;
  const centre = path.startCentre.clone();
  const carried = path.startUp.clone();
  if (path.normal) {
    centre.applyAxisAngle(path.normal, turned);
    carried.applyAxisAngle(path.normal, turned);
  }
  const course = path.normal
    ? new THREE.Vector3().crossVectors(path.normal, centre).normalize()
    : carried.clone();
  const startWeight =
    1 -
    smoothstep(
      Math.max(0, tMs) / (FLIGHT_PATH.startBlendShare * path.durationMs),
    );
  // The roll from the carried start up to the course, taken as the start's
  // weight fades.
  const roll = Math.atan2(
    centre.dot(new THREE.Vector3().crossVectors(carried, course)),
    carried.dot(course),
  );
  const up = carried.applyAxisAngle(centre, roll * (1 - startWeight));
  const law = descentPitchDeg(point.h, {
    landingM: path.landingM,
    entryDeg: path.entryPitchDeg,
    landingDeg: path.landingPitchDeg,
  });
  return {
    centre: done ? path.target.clone() : centre,
    up,
    altitudeM: point.h,
    arcRad: done ? 0 : path.arcRad - turned,
    pitchDeg: done ? path.landingPitchDeg : 90 + (law - 90) * (1 - startWeight),
    startWeight,
    done,
  };
}

/**
 * The camera `tMs` after the press: `obliqueCamera` on the frame's
 * centre, up, altitude and pitch, with the start's own tilt (its offset
 * from its orbit view) fading with the start's weight.
 */
export function flightCamera(
  path: FlightPath,
  tMs: number,
): {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  altitudeM: number;
  done: boolean;
} {
  const f = flightAt(path, tMs);
  const camera = obliqueCamera(
    path.ellipsoid,
    { direction: f.centre, up: f.up },
    f.altitudeM,
    f.pitchDeg,
  );
  const offset = new THREE.Quaternion().slerp(path.startOffset, f.startWeight);
  return {
    position: camera.position,
    quaternion: camera.quaternion.multiply(offset),
    altitudeM: f.altitudeM,
    done: f.done,
  };
}
