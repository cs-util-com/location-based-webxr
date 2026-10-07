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
 *   its own clock is GATED: while the data is not ready the clock runs at
 *   `coldRate` and eases to a stop just before the path reaches `commitM`,
 *   so the camera never goes lower before its data; the data releases it
 *   (the rate returns to 1 with `rateLagMs`). Below `commitM` the clock
 *   always runs at 1, so nothing near the ground changes speed with data.
 *   One path and no replan for the data: a replan from a commit point
 *   cross-faded two geodesics and dipped the speed (measured).
 * - DEC-CF-5: `safetyCapMs` after the press the gate opens regardless.
 * - A touch cancels in every moving phase (the camera is the controls').
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
 * The flight clock at which `flight` first reaches `commitM` going down
 * (a coarse scan, then bisection); its start if it starts there or lower,
 * null if it never gets there.
 */
function gateOf(flight: Flight): number | null {
  const at = (t: number) => flightFrameAt(flight, t).altitudeM;
  const { startedAtMs: a, endsAtMs: b } = flight;
  if (at(a) <= PIN_FLIGHT.commitM) return a;
  let prev = a;
  for (let i = 1; i <= PIN_FLIGHT.gateSamples; i++) {
    const t = a + ((b - a) * i) / PIN_FLIGHT.gateSamples;
    if (at(t) <= PIN_FLIGHT.commitM) {
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

/** With a target: fly the final path, gated until the data is ready. */
function towardTarget(pin: PinFlight, target: OrbitPose): PinFlight {
  const flight = flyTo(pin, target, pin.landingM);
  return {
    ...pin,
    target,
    flight,
    gateClockMs: gateOf(flight),
    phase: released(pin, pin.nowMs) ? "descending" : "approaching",
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
      { direction: start.pose.direction, up: start.pose.up },
      { landingM: PIN_FLIGHT.holdM, viewLandingM: pin.landingM },
      pin.clockMs,
    ),
  };
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
  };
  return options.target ? towardTarget(base, options.target) : holdOver(base);
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
  const moving = ["holding", "approaching", "descending"].includes(now.phase);
  return moving ? { ...now, phase: "cancelled", flight: null } : now;
}

/**
 * The rate the clock steers towards: 1 once released or past the gate;
 * else the cold pace, eased to 0 over `gateEaseMs` of flight time before
 * the gate.
 */
function targetRate(pin: PinFlight, nowMs: number): number {
  if (pin.phase === "descending") return 1;
  const cold = PIN_FLIGHT.coldRate + (1 - PIN_FLIGHT.coldRate) * pin.progress;
  if (pin.phase !== "approaching" || pin.gateClockMs === null) return cold;
  if (released(pin, nowMs)) return 1;
  const toGate = pin.gateClockMs - pin.clockMs;
  return cold * smoothstep(toGate / PIN_FLIGHT.gateEaseMs);
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
