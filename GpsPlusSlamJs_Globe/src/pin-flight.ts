/**
 * The pin's flight from the press to the landing (continuous-flight plan
 * 2026-10-07-0941, CF3): pure, driven by events (the press, the fix or its
 * failure, the data's progress, a touch) and frames.
 *
 * - DEC-CF-4b: the flight starts at the press. Without a target it holds
 *   above `holdM`, over where the camera already looks (no sideways guess:
 *   the intro's fallback target is New York); a fix flies on (a CF2 replan
 *   above the band); a failure ends at the hold.
 * - DEC-CF-3b: with a target the flight flies its final path at once, and
 *   its own clock is GATED: it never carries the camera down through
 *   `commitM` before the data is ready; the data releases it (the rate
 *   climbs to 1 with `rateLagMs`, so a camera stretched slow crosses the
 *   gate still accelerating). Once released, nothing changes the speed with
 *   data. One path and no replan for the data: a replan from a commit point
 *   cross-faded two geodesics and dipped the speed (measured).
 * - DEC-CF-6 (owner, after the CF3 milestone review measured a stop at
 *   about 110 km on cold data): predict and stretch. The data's time left
 *   (its progress so far, extrapolated; before any, `assumedDataMs`)
 *   sets the high stretch's rate, so the camera reaches the gate's ease
 *   zone about when the data is in; only data later than predicted meets
 *   the ease into the gate. Data that reports no progress until it is all
 *   in (one big tile) cannot be predicted beyond the assumption.
 * - DEC-CF-5: `safetyCapMs` after the press the gate opens regardless.
 * - A touch cancels in every moving phase, a failed hold included (the
 *   camera is the controls'). A press already below `commitM` has no gate.
 *
 * The flight clock (`clockMs`) is the CF2 `Flight`'s time axis; the pace
 * scales how fast it runs against the page's clock.
 *
 * @see pin-flight.ts.md
 */

import * as THREE from "three";
import type { Ellipsoid } from "3d-tiles-renderer";

import type { OrbitPose } from "./globe-camera.js";
import { smoothstep } from "./globe-ease.js";
import { surfaceRadiusAlong } from "./globe-dive.js";
import type { FlightStart } from "./flight-path.js";
import {
  flightCameraAt,
  flightFrameAt,
  retargetFlight,
  startFlight,
  type Flight,
} from "./flight-replan.js";

export const PIN_FLIGHT = Object.freeze({
  /** DEC-CF-4b: without a target, the flight holds above this, m. */
  holdM: 2_000_000,
  /** DEC-CF-3b: before its data, the flight goes no lower than this, m. */
  commitM: 100_000,
  /** DEC-CF-5: after this from the press the gate opens regardless, ms. */
  safetyCapMs: 60_000,
  /** The flight clock's rate with no data yet (1 with all of it). */
  coldRate: 0.5,
  /** The rate's lag behind its target, ms (as `flight-pace`'s 800 ms). */
  rateLagMs: 800,
  /** The gate eases the clock to a stop over this much flight time before it, ms. */
  gateEaseMs: 2_000,
  /** Samples to find where the path crosses `commitM`. */
  gateSamples: 256,
  /**
   * DEC-CF-6: before any progress, how long the data is assumed to take, ms
   * (a cold first visit: round 5 measured 15-90 s for a tile). Swept 20, 30
   * and 45 s on 2026-10-07: data reporting progress does not care; data that
   * arrives at once (one big tile) flew without a stop-and-go (0.2) up to
   * 10, 20 and 30 s respectively, at about 1-2 s more for quick data.
   */
  assumedDataMs: 45_000,
  /** The slowest the high stretch flies while it waits for its data. */
  minRate: 0.05,
  /** The stretch aims to meet the data this much later than predicted. */
  arrivalMargin: 1.25,
});

export type PinFlightPhase =
  "holding" | "approaching" | "descending" | "landed" | "failed" | "cancelled";

/** The pin's flight: its phase, its CF2 flight, its gate and its clock. */
export interface PinFlight {
  readonly ellipsoid: Ellipsoid;
  readonly phase: PinFlightPhase;
  /** The flight (null: none yet, the camera hovers at `hover`). */
  readonly flight: Flight | null;
  /** Where the camera hovers while there is no flight. */
  readonly hover: FlightStart;
  /** The target, once known. */
  readonly target: OrbitPose | null;
  readonly landingM: number;
  /** The data's progress, 0-1 (ratcheted). */
  readonly progress: number;
  readonly pressedAtMs: number;
  /** The page time of the last frame or event, ms. */
  readonly nowMs: number;
  /** The flight clock at `nowMs`, and its rate per page ms. */
  readonly clockMs: number;
  readonly rate: number;
  /** The flight clock at which the path reaches `commitM` (null: no gate). */
  readonly gateClockMs: number | null;
  /** When the current target's data started (its fix or link), page ms. */
  readonly dataStartMs: number;
}

function requireTime(nowMs: number): void {
  if (!Number.isFinite(nowMs)) {
    throw new RangeError(`the time must be finite, got ${nowMs}`);
  }
}

const clampProgress = (p: number) =>
  p >= 1 ? 1 : p > 0 && Number.isFinite(p) ? p : 0;

/** Whether the data or the cap opens the gate at `nowMs`. */
const released = (pin: PinFlight, nowMs: number) =>
  pin.progress >= 1 || nowMs - pin.pressedAtMs >= PIN_FLIGHT.safetyCapMs;

/**
 * The flight clock at which `flight` first comes down through `commitM`
 * from above (a coarse scan, then bisection); null if it never does.
 */
function gateOf(flight: Flight): number | null {
  const at = (t: number) => flightFrameAt(flight, t).altitudeM;
  const { startedAtMs: a, endsAtMs: b } = flight;
  // Only where the path comes DOWN through the commit altitude: a press
  // already below it has nothing to wait above (CF3 review finding 7: the
  // gate at its start froze the camera); an arch that climbs above it
  // gets its gate on the way down.
  let above = at(a) > PIN_FLIGHT.commitM;
  let prev = a;
  for (let i = 1; i <= PIN_FLIGHT.gateSamples; i++) {
    const t = a + ((b - a) * i) / PIN_FLIGHT.gateSamples;
    const h = at(t);
    if (!above) {
      above = h > PIN_FLIGHT.commitM;
      prev = t;
      continue;
    }
    if (h <= PIN_FLIGHT.commitM) {
      let lo = prev;
      let hi = t;
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2;
        if (at(mid) <= PIN_FLIGHT.commitM) hi = mid;
        else lo = mid;
      }
      return lo;
    }
    prev = t;
  }
  return null;
}

/** A flight to `target`, from the hover point or replanned at the clock. */
function flyTo(pin: PinFlight, target: OrbitPose, landingM: number): Flight {
  const options = { landingM, viewLandingM: pin.landingM };
  return pin.flight
    ? retargetFlight(pin.flight, pin.clockMs, target, options)
    : startFlight(pin.ellipsoid, pin.hover, target, options, pin.clockMs);
}

/**
 * With a target: fly the final path, gated until ITS data is ready (the
 * progress starts from nothing: any reported before belonged to no target,
 * CF3 review finding 9).
 */
function towardTarget(pin: PinFlight, target: OrbitPose): PinFlight {
  const flight = flyTo(pin, target, pin.landingM);
  const next = { ...pin, progress: 0, dataStartMs: pin.nowMs };
  return {
    ...next,
    target,
    flight,
    gateClockMs: gateOf(flight),
    phase: released(next, pin.nowMs) ? "descending" : "approaching",
  };
}

/** The hold: down to `holdM` over where the camera looks; none if already lower. */
function holdOver(pin: PinFlight): PinFlight {
  const start = pin.hover;
  if (start.distanceM - pin.ellipsoid.radius.x <= PIN_FLIGHT.holdM * 1.001) {
    return pin;
  }
  return {
    ...pin,
    flight: startFlight(
      pin.ellipsoid,
      start,
      { direction: lookedAt(pin.ellipsoid, start), up: start.pose.up },
      { landingM: PIN_FLIGHT.holdM, viewLandingM: pin.landingM },
      pin.clockMs,
    ),
  };
}

/**
 * Where a camera looks: its view's ray against the surface under it (a
 * sphere of that radius), or straight down when it looks past the Earth
 * (CF3 review finding 10: a tilted camera held over its own nadir,
 * thousands of km from its view).
 */
function lookedAt(ellipsoid: Ellipsoid, start: FlightStart): THREE.Vector3 {
  const nadir = start.pose.direction.clone().normalize();
  if (!start.quaternion) return nadir;
  const origin = nadir.clone().multiplyScalar(start.distanceM);
  const ray = new THREE.Vector3(0, 0, -1).applyQuaternion(start.quaternion);
  const r = surfaceRadiusAlong(ellipsoid, nadir);
  // |origin + t ray| = r: t^2 + 2 (origin . ray) t + |origin|^2 - r^2 = 0.
  const b = origin.dot(ray);
  const c = origin.lengthSq() - r * r;
  const disc = b * b - c;
  if (disc < 0) return nadir;
  const t = -b - Math.sqrt(disc);
  if (t <= 0) return nadir;
  return origin.addScaledVector(ray, t).normalize();
}

/**
 * The press: the camera as the intro left it, the target if already known
 * (a fix, a link), the landing and the data's progress so far. RangeError
 * for a time that is not finite or a landing that is not a positive number.
 */
export function pressPin(
  ellipsoid: Ellipsoid,
  nowMs: number,
  camera: FlightStart,
  options: {
    readonly target: OrbitPose | null;
    readonly landingM: number;
    readonly progress: number;
  },
): PinFlight {
  requireTime(nowMs);
  if (!(options.landingM > 0 && Number.isFinite(options.landingM))) {
    throw new RangeError(
      `landingM must be a positive number, got ${options.landingM}`,
    );
  }
  const base: PinFlight = {
    ellipsoid,
    phase: "holding",
    flight: null,
    hover: camera,
    target: null,
    landingM: options.landingM,
    progress: clampProgress(options.progress),
    pressedAtMs: nowMs,
    nowMs,
    clockMs: 0,
    rate: PIN_FLIGHT.coldRate,
    gateClockMs: null,
    dataStartMs: nowMs,
  };
  if (!options.target) return holdOver(base);
  const flying = towardTarget(base, options.target);
  return opened({ ...flying, progress: base.progress });
}

/** The device's fix (or a link's place) arrives: fly on to it. */
export function pinFix(
  pin: PinFlight,
  nowMs: number,
  target: OrbitPose,
): PinFlight {
  const now = advance(pin, nowMs);
  return now.phase === "holding" ? towardTarget(now, target) : now;
}

/** The position failed: the flight ends at the hold. */
export function pinFailed(pin: PinFlight, nowMs: number): PinFlight {
  const now = advance(pin, nowMs);
  return now.phase === "holding" ? { ...now, phase: "failed" } : now;
}

/** The data's progress (0-1, ratcheted); at 1 the gate opens. */
export function pinProgress(
  pin: PinFlight,
  nowMs: number,
  progress: number,
): PinFlight {
  const now = advance(pin, nowMs);
  if (!now.target) return now; // no target yet: its data has not started
  return opened({
    ...now,
    progress: Math.max(now.progress, clampProgress(progress)),
  });
}

/** The approach becomes the descent once the data or the cap opens the gate. */
const opened = (pin: PinFlight): PinFlight =>
  pin.phase === "approaching" && released(pin, pin.nowMs)
    ? { ...pin, phase: "descending" }
    : pin;

/**
 * A new landing (the target's height tile arrived and the floor rose;
 * cold review finding 11): the flight replans to it (a CF2 replan, the
 * gate found again). Only while flying to a target; RangeError for a
 * landing that is not a positive number.
 */
export function pinLanding(
  pin: PinFlight,
  nowMs: number,
  landingM: number,
): PinFlight {
  if (!(landingM > 0 && Number.isFinite(landingM))) {
    throw new RangeError(`landingM must be a positive number, got ${landingM}`);
  }
  const now = advance(pin, nowMs);
  const flying = now.phase === "approaching" || now.phase === "descending";
  if (!flying || !now.target || landingM === now.landingM) return now;
  const next = { ...now, landingM };
  const flight = flyTo(next, now.target, landingM);
  return { ...next, flight, gateClockMs: gateOf(flight) };
}

/** A touch on the globe: the controls take the camera. */
export function pinTouch(pin: PinFlight, nowMs: number): PinFlight {
  const now = advance(pin, nowMs);
  // A failed hold is still moving too (CF3 review finding 6).
  const moving = ["holding", "approaching", "descending", "failed"].includes(
    now.phase,
  );
  return moving ? { ...now, phase: "cancelled", flight: null } : now;
}

/**
 * The data's time still to come, page ms (DEC-CF-6): its progress so far
 * over the time since it started, extrapolated; before any progress, the
 * assumed time less what has passed.
 */
function dataLeftMs(pin: PinFlight, nowMs: number): number {
  const since = Math.max(nowMs - pin.dataStartMs, 1);
  if (pin.progress > 0) return ((1 - pin.progress) / pin.progress) * since;
  // Overdue data with no progress is assumed to need half again as long
  // as it has taken: a shrinking guess sped the camera at a gate it then
  // had to stop at.
  return Math.max(PIN_FLIGHT.assumedDataMs - since, since / 2);
}

/**
 * The rate the clock steers towards. The hold: the cold pace. Released or
 * descending: 1. Approaching (DEC-CF-6, owner 2026-10-07, after the CF3
 * review measured a stop at about 110 km on cold data): STRETCHED so the
 * camera meets its data at the gate (the flight time left to the gate over
 * `arrivalMargin` x the data's time left, between `minRate` and 1), and
 * eased to 0 over `gateEaseMs` before the gate, the fallback when the data
 * is later than predicted.
 */
function targetRate(pin: PinFlight, nowMs: number): number {
  if (pin.phase === "descending") return 1;
  if (pin.phase !== "approaching") return PIN_FLIGHT.coldRate;
  if (released(pin, nowMs) || pin.gateClockMs === null) return 1;
  const toGate = pin.gateClockMs - pin.clockMs;
  // The ease zone in the page's time, by the rate the clock actually runs
  // at (it lags its target by `rateLagMs`): sized in flight time it took
  // up to 9 s of the page's at a stretched rate and braked for data that
  // was on time; sized by the target alone, a camera still fast met a small
  // zone and stopped at the clamp.
  const zone =
    (PIN_FLIGHT.gateEaseMs + 2 * PIN_FLIGHT.rateLagMs) *
    Math.max(pin.rate, PIN_FLIGHT.minRate);
  // Stretched to reach the zone's start, not the gate, as the data ends.
  const stretch = Math.min(
    1,
    Math.max(
      PIN_FLIGHT.minRate,
      Math.max(toGate - zone, 0) /
        (PIN_FLIGHT.arrivalMargin * dataLeftMs(pin, nowMs)),
    ),
  );
  return stretch * smoothstep(toGate / zone);
}

/**
 * Advances the flight clock to `nowMs`: its rate steers towards
 * `targetRate` with a first-order lag, integrated exactly over the step
 * (two frame rates agree), and never past a closed gate.
 */
function advance(pin: PinFlight, nowMs: number): PinFlight {
  requireTime(nowMs);
  const dt = nowMs - pin.nowMs;
  if (!(dt > 0)) return pin;
  const target = targetRate(pin, nowMs);
  const tau = PIN_FLIGHT.rateLagMs;
  const decay = Math.exp(-dt / tau);
  const rate = target + (pin.rate - target) * decay;
  let clockMs =
    pin.clockMs + target * dt + (pin.rate - target) * tau * (1 - decay);
  const closed =
    pin.phase === "approaching" &&
    pin.gateClockMs !== null &&
    !released(pin, nowMs);
  if (closed && pin.gateClockMs !== null) {
    clockMs = Math.min(clockMs, pin.gateClockMs);
  }
  return { ...pin, nowMs, clockMs, rate };
}

/** The flight's camera at the pin's clock, or the hover point. */
function cameraAt(pin: PinFlight): {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  altitudeM: number;
} {
  if (pin.flight) return flightCameraAt(pin.flight, pin.clockMs);
  const position = pin.hover.pose.direction
    .clone()
    .multiplyScalar(pin.hover.distanceM);
  return {
    position,
    quaternion: pin.hover.quaternion?.clone() ?? new THREE.Quaternion(),
    altitudeM: pin.hover.distanceM - pin.ellipsoid.radius.x,
  };
}

/**
 * One frame at page time `nowMs`: the pin advanced (the cap may open the
 * gate; a flight's end lands it) and its camera, or null once cancelled.
 * RangeError for a time that is not finite.
 */
export function pinFrame(
  pin: PinFlight,
  nowMs: number,
): {
  pin: PinFlight;
  camera: {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    altitudeM: number;
  } | null;
} {
  let next = opened(advance(pin, nowMs));
  if (next.phase === "cancelled") return { pin: next, camera: null };
  if (
    next.phase === "descending" &&
    next.flight &&
    next.clockMs >= next.flight.endsAtMs
  ) {
    next = { ...next, phase: "landed" };
  }
  const cam = cameraAt(next);
  return {
    pin: next,
    camera: {
      position: cam.position,
      quaternion: cam.quaternion,
      altitudeM: cam.altitudeM,
    },
  };
}
