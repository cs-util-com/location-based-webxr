/**
 * The pin's continuous flight (continuous-flight plan 2026-10-07-0941,
 * CF1): from wherever the camera is to `landingM` above the target, as
 * one movement that never stops in between. Pure: time in; the camera's
 * view centre, altitude, pitch and up (`flightAt`), or its position and
 * rotation (`flightCamera`), out.
 *
 * THE CAMERA flies `flight-travel`'s curve (round-2 plan 2026-10-07-2350,
 * DEC-FR2-1 and DEC-FR2-2, after the owner's "the camera must always look
 * in the direction of flight; it should END at 45 degrees" and "turn first,
 * then a curve, straight towards the Earth's centre, then bending"): along
 * the great circle to the target, turning high up while it looks down, then
 * diving straight down and bending into 45 degrees at the landing. Its path
 * length is the measure the flight is judged by (v = sqrt((d ln h/dt)^2 +
 * (ground speed / h)^2)), so at a constant ds/dt the camera's speed is
 * constant by it. It replaced van Wijk and Nuij's zoom-and-pan (CF1), whose
 * descent ends nearly vertical and so could not end at 45 degrees.
 *
 * THE CLOCK is the one exception to the constant speed: a ramp from the
 * start's speed over `rampMs`, and one settle over the last ln(settleFactor)
 * of the path (from about settleFactor x the landing down), each a
 * smoothstep in the speed. A path too short for that is a cubic Hermite
 * from the start's speed to rest.
 *
 * THE VIEW looks from the camera at a centre ahead of it along its course,
 * at the curve's pitch: for R1 straight down above the bend and the
 * camera's own direction of travel below it (never shallower than the
 * dive's own angle); for a meteor its line, looked along at every altitude
 * (F1b). It ends looking at the target at the law's landing angle (45 for
 * R1, the asked angle for a meteor: DEC-R3-9, DEC-R3-12). The course runs along the great circle to the target; a
 * target nearer than one landing keeps the start's heading (CF1 review
 * finding 5). The start's own pitch, heading (one roll, fixed when planned:
 * finding 1) and tilt blend out over the first fifth, so the press never
 * snaps the view.
 *
 * @see flight-path.ts.md
 */

import * as THREE from "three";
import type { Ellipsoid } from "3d-tiles-renderer";

import type { OrbitPose } from "./globe-camera.js";
import { smoothstep } from "./globe-ease.js";
import { obliqueCamera, surfaceRadiusAlong } from "./globe-dive.js";
import { planTravel, travelLawDeg, type TravelCurve } from "./flight-travel.js";

export const FLIGHT_PATH = Object.freeze({
  /** The flight on its own clock (today's dive's 15 s). */
  durationMs: 15_000,
  /** The speed's ramp from the start's, ms (at most a quarter of the flight). */
  rampMs: 800,
  /**
   * The settle covers the path's last ln(this): from about this many
   * landings down (3.3 s of the default flight). Swept 2-5 in the tests.
   */
  settleFactor: 3,
  /** The share of the flight over which the start's own view blends out. */
  startBlendShare: 0.2,
  /** The mean radius the ground distance and the horizon are taken on. */
  radiusM: 6_371_000,
});

const DEG = Math.PI / 180;

function requirePositive(name: string, value: number): void {
  if (!(value > 0 && Number.isFinite(value))) {
    throw new RangeError(`${name} must be a positive number, got ${value}`);
  }
}

function requireAtLeast(name: string, value: number, min: number): void {
  if (!(value >= min && Number.isFinite(value))) {
    throw new RangeError(`${name} must be ${min} or more, got ${value}`);
  }
}

function requireAbove(name: string, value: number, min: number): void {
  if (!(value > min && Number.isFinite(value))) {
    throw new RangeError(`${name} must be above ${min}, got ${value}`);
  }
}

function requirePitch(name: string, value: number): void {
  if (!(value > 0 && value <= 90)) {
    throw new RangeError(`${name} must be in (0, 90] degrees, got ${value}`);
  }
}

/**
 * The angle (radians) a camera at `altitudeM` over a surface of radius
 * `rs` stands behind the ground point it looks at with a depression of
 * `pitchDeg` (the triangle centre-camera-ground, as `obliqueCamera`).
 */
function lookBackRad(rs: number, altitudeM: number, pitchDeg: number): number {
  const gamma = (90 - pitchDeg) * DEG;
  if (gamma <= 1e-12) return 0;
  return (
    Math.asin(Math.min(1, ((rs + altitudeM) / rs) * Math.sin(gamma))) - gamma
  );
}

/** Fixed-point steps for a centre over its own surface (see `centreAhead`). */
const FIXED_POINT_STEPS = 4;

/**
 * The ground point a camera in direction `camera` looks at, `altitudeM`
 * over the surface UNDER THAT POINT (as `obliqueCamera` measures it) with
 * a depression of `pitchDeg`, ahead of it about `axis`. The surface radius
 * changes by metres per kilometre, so the fixed point converges by a factor
 * of about 1e-3 per step; four steps leave well under a millimetre.
 */
function centreAhead(
  ellipsoid: Ellipsoid,
  camera: THREE.Vector3,
  axis: THREE.Vector3,
  altitudeM: number,
  pitchDeg: number,
): THREE.Vector3 {
  let centre = camera.clone();
  for (let i = 0; i < FIXED_POINT_STEPS; i++) {
    const rs = surfaceRadiusAlong(ellipsoid, centre);
    centre = camera
      .clone()
      .applyAxisAngle(axis, lookBackRad(rs, altitudeM, pitchDeg));
  }
  return centre;
}

/** Where the camera is when a flight begins. */
export interface FlightStart {
  /**
   * The camera's direction from the centre and its screen's up (for an
   * oblique start, the up along which it looks ahead).
   */
  readonly pose: OrbitPose;
  /** Its distance from the centre, metres. */
  readonly distanceM: number;
  /** Its rotation, if the controls tilted it off its view. */
  readonly quaternion?: THREE.Quaternion;
  /** Its view's depression, degrees (90, the default, looks straight down). */
  readonly pitchDeg?: number;
}

/** The clock: the path length travelled by a time, and the cruise between. */
interface Clock {
  readonly at: (tMs: number) => number;
  /** The settle's path length (0 for a short path's Hermite). */
  readonly settle: number;
  /** The cruise speed (path length per ms; 0 for a short path's Hermite). */
  readonly speed: number;
  readonly cruise: { readonly fromMs: number; readonly toMs: number } | null;
}

/** The integral of smoothstep from 0 to x. */
const smoothIntegral = (x: number) => x ** 3 - x ** 4 / 2;

/**
 * The share c of a ramp's span flown at the cruise speed: a ramp from s0
 * to v over T covers T (s0 (1 - c) + v c). A full smoothstep ramp has
 * c = 1/2; one that starts at `fromShare` of its smoothstep (a replan
 * continuing an old ramp's tail) has c = (Q - S0) / (1 - S0), S0 the
 * smoothstep there and Q its mean over the rest.
 */
export function rampCruiseShare(fromShare: number): number {
  const s0 = smoothstep(fromShare);
  if (s0 >= 1) return 1;
  const q = (0.5 - smoothIntegral(fromShare)) / (1 - fromShare);
  return (q - s0) / (1 - s0);
}

function flightClock(
  length: number,
  durationMs: number,
  startSpeed: number,
  settleFactor: number,
  rampMs: number,
  rampFromShare: number,
  brake: boolean,
  settleLength: number | null,
): Clock {
  if (brake) return hermiteClock(length, durationMs, startSpeed);
  const ramp = Math.min(rampMs, durationMs / 4);
  const settle =
    settleLength === null
      ? Math.min(Math.log(settleFactor), length / 3)
      : Math.min(settleLength, length);
  // The cruise speed that ends the path at the duration (see the md): a
  // ramp covers ramp (s0 (1 - c) + v c), c from `rampCruiseShare`.
  const c = rampCruiseShare(rampFromShare);
  const v =
    (length + settle - startSpeed * ramp * (1 - c)) /
    (durationMs - ramp * (1 - c));
  const settleMs = settle > 0 && v > 0 ? (2 * settle) / v : 0;
  const cruiseMs = durationMs - ramp - settleMs;
  const rampLength = ramp * (startSpeed * (1 - c) + v * c);
  if (!(v > 0) || cruiseMs < 0 || rampLength + settle > length) {
    return hermiteClock(length, durationMs, startSpeed);
  }
  // The ramp's speed: the tail of a smoothstep from `rampFromShare`, scaled
  // to run from s0 to v (a full one from 0 is the press's ramp).
  const x0 = rampFromShare;
  const s0Share = smoothstep(x0);
  const k = (v - startSpeed) / (1 - s0Share);
  const i0 = smoothIntegral(x0);
  return {
    settle,
    speed: v,
    cruise: { fromMs: ramp, toMs: ramp + cruiseMs },
    at: (t) => {
      if (t <= 0) return 0;
      if (t >= durationMs) return length;
      if (t < ramp) {
        const u = t / ramp;
        const tail =
          (smoothIntegral(x0 + (1 - x0) * u) - i0) / (1 - x0) - s0Share * u;
        return ramp * (startSpeed * u + k * tail);
      }
      if (t < ramp + cruiseMs) return rampLength + v * (t - ramp);
      const x = (t - ramp - cruiseMs) / settleMs;
      return length - settle + v * settleMs * (x - smoothIntegral(x));
    },
  };
}

/**
 * A path too short for a cruise: a cubic Hermite from the start's speed to
 * rest (CF1 review finding 3: the old fallback started from rest, a jump
 * for a replan in motion). Its slope is the start's speed at 0, so it
 * would pass the end when that speed covers more than 3 x the length in
 * the duration; the speed is then capped there (the one case the start's
 * speed is not kept: a replan right at the end of a short path).
 */
function hermiteClock(
  length: number,
  durationMs: number,
  startSpeed: number,
): Clock {
  const m0 = Math.min(startSpeed * durationMs, 3 * length);
  return {
    settle: 0,
    speed: 0,
    cruise: null,
    at: (t) => {
      if (t <= 0) return 0;
      if (t >= durationMs) return length;
      const x = t / durationMs;
      const h01 = -2 * x ** 3 + 3 * x ** 2;
      const h11 = x ** 3 - 2 * x ** 2 + x;
      return Math.min(length, h01 * length + h11 * m0);
    },
  };
}

/** A planned flight, for `flightAt` and `flightCamera`. */
export interface FlightPath {
  readonly ellipsoid: Ellipsoid;
  readonly durationMs: number;
  readonly landingM: number;
  /** The landing the view's law refers to, and the view's pitch at the end. */
  readonly viewLandingM: number;
  readonly endPitchDeg: number;
  /** The meteor's beta the path flies (90: R1). */
  readonly meteorDeg: number;
  /**
   * The angle it lands at, when not its law's default (a press that fitted
   * a steeper line than asked lands at the asked angle: DEC-R3-12).
   */
  readonly meteorLandDeg: number | undefined;
  /** The target's direction, a unit vector. */
  readonly target: THREE.Vector3;
  /** The course's great circle, by its normal: the view looks ahead about it. */
  readonly courseNormal: THREE.Vector3;
  /** The angle from the start's view centre to the target, radians. */
  readonly arcRad: number;
  /** The camera's start and end directions. */
  readonly cameraStart: THREE.Vector3;
  readonly cameraEnd: THREE.Vector3;
  /**
   * The camera moves in the course's plane: from `planeStart` (the start in
   * that plane) by a signed angle about `courseNormal`, `cameraArcRad` to
   * its end (negative when the end lies behind the start along the course),
   * the start's offset from the plane (`offPlaneRad`, only within one
   * landing of the target) dying out with the turn.
   */
  readonly planeStart: THREE.Vector3;
  readonly offPlaneRad: number;
  readonly cameraArcRad: number;
  /** The travel curve's length (the name is CF1's, when it was a geodesic). */
  readonly geodesicLength: number;
  /** The path length travelled by a time after the press. */
  readonly travelledAt: (tMs: number) => number;
  /** The cruise's speed, path length per ms (0 for a short path). */
  readonly cruiseSpeed: number;
  /** The settle's path length (0 for a short path). */
  readonly settleLength: number;
  /** The view law's pitch at the start's altitude (the start blends from it). */
  readonly startLawDeg: number;
  /** Where in its smoothstep the ramp started (0 for a full ramp). */
  readonly rampFromShare: number;
  /** The cruise, between the ramp and the settle (null for a short path). */
  readonly cruise: { readonly fromMs: number; readonly toMs: number } | null;
  /** The start's pitch, the roll from its up to the course, and its tilt. */
  readonly startPitchDeg: number;
  readonly startRollRad: number;
  readonly startOffset: THREE.Quaternion;
  /** The curve's point at a path length (`flight-travel`). */
  readonly geodesicAt: TravelCurve["at"];
  /** The dive's own ground track from the bend down, rad (a nearer start backs off). */
  readonly diveArcRad: number;
  /** The view's pitch at a path length: the camera's travel below the bend. */
  readonly pitchAt: TravelCurve["pitchAt"];
}

/** A unit vector in the plane perpendicular to `direction`, from `v`. */
function tangent(v: THREE.Vector3, direction: THREE.Vector3): THREE.Vector3 {
  return v.clone().projectOnPlane(direction).normalize();
}

/**
 * The course's normal: along the great circle from the camera's start
 * (`from`) to the target, or the start's heading for a target nearer than
 * one landing. Exactly perpendicular to the target, so the target and the
 * camera's end lie in the course's plane: near the antipode the cross
 * product is about 1e-12 long, its normal off by about 1e-4, and the
 * path's end missed `cameraEnd` by micrometres, a snap at the landing
 * (a property counterexample, 2026-10-08).
 */
function courseNormal(
  from: THREE.Vector3,
  target: THREE.Vector3,
  startUp: THREE.Vector3,
  landingM: number,
): THREE.Vector3 {
  const n = rawCourseNormal(from, target, startUp, landingM);
  return n.addScaledVector(target, -n.dot(target)).normalize();
}

function rawCourseNormal(
  from: THREE.Vector3,
  target: THREE.Vector3,
  startUp: THREE.Vector3,
  landingM: number,
): THREE.Vector3 {
  const cross = new THREE.Vector3().crossVectors(from, target);
  const arc = Math.atan2(cross.length(), from.dot(target));
  if (arc * FLIGHT_PATH.radiusM >= landingM && cross.length() > 1e-12) {
    return cross.normalize();
  }
  if (arc * FLIGHT_PATH.radiusM >= landingM) {
    // Antipodes: over the start's up, as `turnPose` does.
    return new THREE.Vector3().crossVectors(from, startUp).normalize();
  }
  // A target nearer than one landing: the start's heading, at the target.
  const up = tangent(startUp, target);
  return new THREE.Vector3().crossVectors(target, up).normalize();
}

/** An option, or its default. */
const or = <T>(value: T | undefined, fallback: T): T =>
  value === undefined ? fallback : value;

/** The options with their defaults, validated (see `planFlight`). */
function flightOptions(
  start: FlightStart,
  options: Parameters<typeof planFlight>[3],
) {
  const o = {
    landingM: options.landingM,
    durationMs: or(options.durationMs, FLIGHT_PATH.durationMs),
    startPitchDeg: or(start.pitchDeg, 90),
    startSpeed: or(options.startSpeed, 0),
    settleFactor: or(options.settleFactor, FLIGHT_PATH.settleFactor),
    rampMs: or(options.rampMs, FLIGHT_PATH.rampMs),
    rampFromShare: or(options.rampFromShare, 0),
    brake: or(options.brake, false),
    settleLength: or(options.settleLength, null),
    viewLandingM: or(options.viewLandingM, options.landingM),
    meteorDeg: or(options.meteorDeg, 90),
    meteorLandDeg: options.meteorLandDeg,
  };
  if (!(o.meteorDeg > 0 && o.meteorDeg <= 90)) {
    throw new RangeError(`meteorDeg must be in (0, 90], got ${o.meteorDeg}`);
  }
  if (
    o.meteorLandDeg !== undefined &&
    !(o.meteorLandDeg > 0 && o.meteorLandDeg <= 90)
  ) {
    throw new RangeError(
      `meteorLandDeg must be in (0, 90], got ${o.meteorLandDeg}`,
    );
  }
  requirePositive("landingM", o.landingM);
  requirePositive("durationMs", o.durationMs);
  requirePositive("start.distanceM", start.distanceM);
  requirePositive("viewLandingM", o.viewLandingM);
  requirePitch("start.pitchDeg", o.startPitchDeg);
  requireAtLeast("startSpeed", o.startSpeed, 0);
  requireAbove("settleFactor", o.settleFactor, 1);
  requireAtLeast("rampMs", o.rampMs, 0);
  if (o.settleLength !== null)
    requireAtLeast("settleLength", o.settleLength, 0);
  if (!(o.rampFromShare >= 0 && o.rampFromShare < 1)) {
    throw new RangeError(
      `rampFromShare must be in [0, 1), got ${o.rampFromShare}`,
    );
  }
  return o;
}

/**
 * The start's view: its centre ahead of the camera along its up, and its
 * altitude over the surface under that centre (as `obliqueCamera` measures
 * it), settled together.
 */
function startView(
  ellipsoid: Ellipsoid,
  cameraStart: THREE.Vector3,
  startUp: THREE.Vector3,
  distanceM: number,
  pitchDeg: number,
): { h0: number; startCentre: THREE.Vector3 } {
  const axis = new THREE.Vector3().crossVectors(cameraStart, startUp);
  let h0 = Math.max(1, distanceM - surfaceRadiusAlong(ellipsoid, cameraStart));
  for (let i = 0; i < FIXED_POINT_STEPS; i++) {
    const c = centreAhead(ellipsoid, cameraStart, axis, h0, pitchDeg);
    h0 = Math.max(1, distanceM - surfaceRadiusAlong(ellipsoid, c));
  }
  return {
    h0,
    startCentre: centreAhead(ellipsoid, cameraStart, axis, h0, pitchDeg),
  };
}

/**
 * The heading's roll from the start's up to the course at the start, fixed
 * once (CF1 review finding 1): recomputed per frame, the cross product of
 * two near-opposite vectors was rounding noise and flipped its sign, the
 * view by up to 179 degrees in a frame. Exactly opposite rolls +pi.
 */
function startRoll(
  normal: THREE.Vector3,
  cameraStart: THREE.Vector3,
  startUp: THREE.Vector3,
): number {
  const course = new THREE.Vector3()
    .crossVectors(normal, cameraStart)
    .projectOnPlane(cameraStart);
  if (course.length() < 1e-12) return 0;
  const sin = cameraStart.dot(
    new THREE.Vector3().crossVectors(startUp, course),
  );
  const cos = startUp.dot(course);
  if (Math.abs(sin) < 1e-9 * course.length() && cos < 0) return Math.PI;
  return Math.atan2(sin, cos);
}

/**
 * A flight from `start` to `landingM` above `target`'s surface point.
 * `startSpeed` is the path's speed at the press (path length per ms; 0,
 * the default, starts from rest). RangeError for a landing or a duration
 * that is not a positive number, a pitch outside (0, 90], a negative start
 * speed, a settle factor not above 1, a start distance that is not a
 * positive number, or a start whose up is parallel to its direction.
 */
export function planFlight(
  ellipsoid: Ellipsoid,
  start: FlightStart,
  target: OrbitPose,
  options: {
    readonly landingM: number;
    readonly durationMs?: number;
    readonly startSpeed?: number;
    readonly settleFactor?: number;
    /**
     * The landing the view's law refers to (default: `landingM`). A path
     * that stops short of the real landing (CF3's hold) passes the
     * real one, so it looks there as the whole flight would.
     */
    readonly viewLandingM?: number;
    /**
     * The speed's ramp from `startSpeed` to the cruise, ms (default
     * `FLIGHT_PATH.rampMs`; a replan passes what its old ramp had left, or
     * none when the speeds already match).
     */
    readonly rampMs?: number;
    /**
     * Where in a smoothstep ramp this one starts, 0-1 (default 0): a replan
     * continuing an old ramp passes the share it had reached, so the speed
     * follows the old ramp's tail exactly.
     */
    readonly rampFromShare?: number;
    /**
     * Brake from `startSpeed` to rest over the whole flight (a cubic
     * Hermite), with no cruise: a replan in the final settle, which a
     * cruise would have re-accelerated.
     */
    readonly brake?: boolean;
    /**
     * The settle's path length, overriding min(ln(settleFactor), L / 3):
     * a replan to the same destination keeps the old flight's, so its
     * settle starts where the old one would have (CF3 review finding 3).
     */
    readonly settleLength?: number;
    /**
     * The meteor's entry angle beta (round-3 plan 2026-10-08-2345 F1, F1b):
     * the travel law is the straight line meeting the landing at beta,
     * landing at `meteorLandDeg` (beta by default). 90 (the default) is R1.
     */
    readonly meteorDeg?: number;
    /**
     * The angle it lands at (DEC-R3-12): absent, the law's default (beta
     * for a line, 45 for R1); a press that fitted a steeper line than
     * asked passes the asked angle, and eases to it below the bend.
     */
    readonly meteorLandDeg?: number;
  },
): FlightPath {
  const o = flightOptions(start, options);
  const { landingM } = o;
  // The view at the end: the travel law of the landing the view refers to
  // (45 degrees at a real landing; straight down at a hold above the bend).
  const endPitchDeg = travelLawDeg(
    landingM,
    o.viewLandingM,
    o.meteorDeg,
    o.meteorLandDeg,
  );
  const cameraStart = start.pose.direction.clone().normalize();
  const up0 = start.pose.up.clone().projectOnPlane(cameraStart);
  if (!(up0.length() > 1e-9)) {
    throw new RangeError(
      "the start's up must not be parallel to its direction",
    );
  }
  const startUp = up0.normalize();
  const to = target.direction.clone().normalize();
  const { h0, startCentre } = startView(
    ellipsoid,
    cameraStart,
    startUp,
    start.distanceM,
    o.startPitchDeg,
  );
  const arcRad = startCentre.angleTo(to);
  // From the camera, which travels: an oblique view can look past the
  // target, and a course from its centre pointed back at the camera.
  const normal = courseNormal(cameraStart, to, startUp, landingM);

  // The camera's end: behind the target along the course, at the landing.
  const cameraEnd = to
    .clone()
    .applyAxisAngle(
      normal,
      -lookBackRad(surfaceRadiusAlong(ellipsoid, to), landingM, endPitchDeg),
    );
  // The camera moves in the course's plane by a SIGNED angle (R1 milestone
  // review: the unsigned arc to an end behind the start, the pin's ordinary
  // press over its own fix, flew the whole dive backwards). The target and
  // the end lie in the plane; a start within one landing of the target can
  // lie off it (the plane runs along its own heading there).
  const offPlaneRad = Math.asin(
    Math.max(-1, Math.min(1, cameraStart.dot(normal))),
  );
  const planeStart = cameraStart
    .clone()
    .addScaledVector(normal, -cameraStart.dot(normal))
    .normalize();
  const cameraArcRad = Math.atan2(
    new THREE.Vector3().crossVectors(planeStart, cameraEnd).dot(normal),
    planeStart.dot(cameraEnd),
  );
  const path = planTravel(h0, landingM, cameraArcRad, {
    landingM: o.viewLandingM,
    meteorDeg: o.meteorDeg,
    meteorLandDeg: o.meteorLandDeg,
  });
  const clock = flightClock(
    path.length,
    o.durationMs,
    o.startSpeed,
    o.settleFactor,
    o.rampMs,
    o.rampFromShare,
    o.brake,
    o.settleLength,
  );
  const startRollRad = startRoll(normal, cameraStart, startUp);
  const { durationMs, startPitchDeg } = o;

  // The start's tilt: its rotation relative to the view this path starts with.
  const reference = obliqueCamera(
    ellipsoid,
    { direction: startCentre, up: tangent(startUp, startCentre) },
    h0,
    startPitchDeg,
  ).quaternion;
  return {
    ellipsoid,
    durationMs,
    landingM,
    viewLandingM: o.viewLandingM,
    meteorDeg: o.meteorDeg,
    meteorLandDeg: o.meteorLandDeg,
    endPitchDeg,
    target: to,
    courseNormal: normal,
    arcRad,
    cameraStart,
    cameraEnd,
    planeStart,
    offPlaneRad,
    cameraArcRad,
    geodesicLength: path.length,
    travelledAt: clock.at,
    cruiseSpeed: clock.speed,
    settleLength: clock.settle,
    rampFromShare: o.rampFromShare,
    cruise: clock.cruise,
    startPitchDeg,
    startLawDeg: path.pitchAt(0),
    startRollRad,
    startOffset: start.quaternion
      ? reference.invert().multiply(start.quaternion)
      : new THREE.Quaternion(),
    geodesicAt: path.at,
    pitchAt: path.pitchAt,
    diveArcRad: path.diveArcRad,
  };
}

/**
 * The view of a camera in direction `camera` heading along `heading` (a
 * tangent there), `altitudeM` up, looking `pitchDeg` below its horizontal:
 * the ground point it looks at, ahead along the heading (over the surface
 * under that point, as `obliqueCamera` measures it), and the screen's up
 * there. The flight builds its view from its camera with it, and so does a
 * replan's join (which moves the camera, never the view: CF3 found that
 * moving the view and placing the camera behind it at a corrected altitude
 * slid the camera sideways).
 */
export function viewFromCamera(
  ellipsoid: Ellipsoid,
  camera: THREE.Vector3,
  heading: THREE.Vector3,
  altitudeM: number,
  pitchDeg: number,
): { centre: THREE.Vector3; up: THREE.Vector3 } {
  const axis = new THREE.Vector3().crossVectors(camera, heading).normalize();
  const centre = centreAhead(ellipsoid, camera, axis, altitudeM, pitchDeg);
  const up = heading.clone().applyAxisAngle(axis, camera.angleTo(centre));
  return { centre, up: tangent(up, centre) };
}

/** One instant of a flight. */
export interface FlightFrame {
  /** The view's centre, a unit vector. */
  readonly centre: THREE.Vector3;
  /** The screen's up at the centre: the course, blended from the start's. */
  readonly up: THREE.Vector3;
  /** The camera's direction from the Earth's centre, a unit vector. */
  readonly camera: THREE.Vector3;
  /** The camera's heading, a tangent at the camera. */
  readonly heading: THREE.Vector3;
  /** The camera's height above the surface, metres. */
  readonly altitudeM: number;
  /** The angle from the view's centre to the target, radians. */
  readonly arcRad: number;
  /** The view's depression, degrees. */
  readonly pitchDeg: number;
  /** The start's own view's remaining weight, 1 at the press to 0. */
  readonly startWeight: number;
  readonly done: boolean;
}

/**
 * The flight `tMs` after the press; the ends are exact and held.
 * RangeError for a time that is not a number.
 */
export function flightAt(path: FlightPath, tMs: number): FlightFrame {
  if (Number.isNaN(tMs)) throw new RangeError("the time must be a number");
  const done = tMs >= path.durationMs;
  const s = path.travelledAt(Math.max(0, tMs));
  const point = path.geodesicAt(tMs <= 0 ? 0 : s);
  // Along the course by the curve's signed angle (not clamped: a start
  // nearer than the dive's own track backs off first; clamped, it stood
  // still and only descended), off the plane by what is left of the
  // start's offset.
  const off = path.offPlaneRad * point.residualLeft;
  const camera = path.planeStart
    .clone()
    .applyAxisAngle(path.courseNormal, point.angle)
    .multiplyScalar(Math.cos(off))
    .addScaledVector(path.courseNormal, Math.sin(off));
  if (done) camera.copy(path.cameraEnd);
  const startWeight =
    1 -
    smoothstep(
      Math.max(0, tMs) / (FLIGHT_PATH.startBlendShare * path.durationMs),
    );
  // The heading at the camera: the course, rolled back towards the
  // start's up by the start's weight.
  const course = tangent(
    new THREE.Vector3().crossVectors(path.courseNormal, camera),
    camera,
  );
  const heading = course.applyAxisAngle(
    camera,
    -path.startRollRad * startWeight,
  );
  const law = path.pitchAt(s);
  const pitchDeg = done
    ? path.endPitchDeg
    : // The start's OFFSET from the law blends out, so the view turns with
      // the law from the first instant (CF3 review finding 5: blending the
      // law in froze the turn at every replan).
      law + (path.startPitchDeg - path.startLawDeg) * startWeight;
  const view = viewFromCamera(
    path.ellipsoid,
    camera,
    heading,
    point.h,
    pitchDeg,
  );
  const centre = done ? path.target.clone() : view.centre;
  return {
    centre,
    up: tangent(view.up, centre),
    camera,
    heading,
    altitudeM: point.h,
    arcRad: done ? 0 : centre.angleTo(path.target),
    pitchDeg,
    startWeight,
    done,
  };
}

/**
 * The camera `tMs` after the press: `obliqueCamera` on the frame's
 * centre, up, altitude and pitch, with the start's own tilt (its offset
 * from its view) fading with the start's weight.
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
