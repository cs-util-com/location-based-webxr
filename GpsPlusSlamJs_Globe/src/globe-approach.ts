/**
 * The globe's approach (globe plan §7.6, round-5 plan 2026-10-01-0945
 * §3.1): the intro flight from the globe to the place, and the pin's dive
 * or continuous flight down to it. Moved out of the globe lab as a pure
 * refactor (editor-on-the-full-globe plan, the approach slice).
 *
 * The states: `spin` until a target is chosen, `turning` towards it (the
 * fly-in), then `arrived`, holding it; `user` once the user has taken the
 * camera; `diving` down to the pin's position and `landed` at the landing
 * altitude. `pose(now)` returns either an orbit `pose` (with `distanceM`,
 * null for the fitted distance, and `fovDeg`) or, during the dive and the
 * pin flight, the camera's `position` and `quaternion`. `history` records
 * each phase and source change with its time since the start, and `runs`
 * counts the starts, so a test reads the sequence instead of racing it.
 *
 * The fly-in starts at the zoom-out limit on the sun side (the target
 * turned towards the sub-solar point by at most `turnCap`) and ends at the
 * target at the fitted distance, over `turnMs`, in the `intro` variant, at
 * the lab's `fovY`. While it waits for a target it spins out there; when a
 * target arrives (a link, a position, the fallback) the start is computed
 * from it and, if the spin was shown, blended to from the spin's direction
 * over `GLOBE_INTRO.lateFixBlendMs`. A position that arrives while the
 * fallback is flown to or held becomes the target over the same blend
 * (`setFix`); without a granted permission none will come (`noFixComing`).
 *
 * @see globe-approach.ts.md
 */
import * as THREE from "three";
import type { Ellipsoid } from "3d-tiles-renderer";

import { orbitPose, type OrbitPose } from "./globe-camera.js";
import { diveStep, planDive, type Dive, type DiveStart } from "./globe-dive.js";
import { flightCameraAt, flightFrameAt } from "./flight-replan.js";
import {
  GLOBE_INTRO,
  type INTRO_VARIANTS,
  type Vec3,
  blendTarget,
  flyInStart,
  introCameraPose,
  spinDirection,
} from "./globe-intro.js";
import { pinFrame, pinTouch, type PinFlight } from "./pin-flight.js";
import {
  GLOBE_FALLBACK_TARGET,
  chooseGlobeTarget,
  type GlobeTargetSource,
  type LatLng,
} from "./globe-target.js";

/** The spin's rate while the intro waits for a target, degrees per second. */
export const SPIN_DEG_PER_S = -3;

/** The approach's phases, in the order a run passes them. */
type ApproachPhase =
  "spin" | "turning" | "arrived" | "user" | "diving" | "landed";

/** Where the target came from: the intro's sources, or the pin. */
type ApproachSource = GlobeTargetSource | "pin";

/** The lab's knobs the approach reads (its `params`, of which it uses these). */
export interface GlobeApproachParams {
  readonly url: LatLng | undefined;
  readonly spinMs: number;
  readonly turnMs: number;
  readonly intro: (typeof INTRO_VARIANTS)[number];
  readonly maxKm: number;
  readonly turnCap: number;
  readonly fovY: number;
  readonly pitchLow: number;
}

/** An orbit frame: the pose, its distance (null: the fitted one), its fov. */
export interface ApproachOrbitStep {
  readonly pose: OrbitPose;
  readonly distanceM: number | null;
  readonly fovDeg: number;
}

/** A placed frame (the dive, the pin flight): the camera's own pose. */
export interface ApproachPlacedStep {
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  readonly altitudeM?: number;
  readonly done?: boolean;
}

export type ApproachStep = ApproachOrbitStep | ApproachPlacedStep;

interface HistoryEntry {
  readonly phase: ApproachPhase;
  readonly source: ApproachSource;
  readonly atMs: number;
}

/**
 * What restarts the intro when it changes; everything else applies live.
 */
export const approachRestartKey = (p: GlobeApproachParams): string =>
  JSON.stringify([
    p.url?.lat,
    p.url?.lng,
    p.spinMs,
    p.turnMs,
    p.intro,
    p.maxKm,
    p.turnCap,
  ]);

/** A north-up orbit pose for a direction [x, y, z] from the centre. */
export function poseToward([x, y, z]: Vec3): OrbitPose {
  const direction = new THREE.Vector3(x, y, z).normalize();
  const up = new THREE.Vector3(0, 0, 1);
  up.addScaledVector(direction, -up.dot(direction));
  if (up.lengthSq() < 1e-12) {
    up.set(1, 0, 0).addScaledVector(direction, -direction.x);
  }
  return { direction, up: up.normalize() };
}

const asArray = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];

/**
 * The approach on `ellipsoid`. `sunEcef` is the sun's direction now,
 * `fitDistance` the distance that fits the Earth in view, `zoomOutM` the
 * zoom-out limit (all read each frame). `now` is the clock `state()` reads
 * (default `performance.now`); every other method takes its time.
 */
export function createGlobeApproach(
  ellipsoid: Ellipsoid,
  {
    sunEcef,
    fitDistance,
    zoomOutM,
    now: clockNow = () => performance.now(),
  }: {
    sunEcef: () => THREE.Vector3;
    fitDistance: () => number;
    zoomOutM: () => number;
    now?: () => number;
  },
) {
  // Set by the first `restart`, which the lab calls before any frame.
  let params!: GlobeApproachParams;
  let startedAt = 0;
  let phase: ApproachPhase = "spin";
  let choice: { target: LatLng | null; source: ApproachSource } = {
    target: null,
    source: "waiting",
  };
  let to!: OrbitPose;
  let turnStartedAt = 0;
  let history: HistoryEntry[] = [];
  let runs = 0;
  /** The dive in progress (`planDive`) and when it began. */
  let dive: Dive | null = null;
  let diveStartedAt = 0;
  /**
   * The dive's elapsed time from the real one (`globe-arrival.ts`'s dive
   * clock: as it is when fixed, the paced path when the prefetch runs).
   */
  let diveClock = (elapsedMs: number) => elapsedMs;
  /** A fixed dive time (ms) the pose holds at, for the smokes; null: run. */
  let diveHoldMs: number | null = null;
  /** The continuous flight: the pin flight that drives the camera instead of `dive`. */
  let pinFlight: PinFlight | null = null;
  /** The pin flight's last drawn pose. */
  let lastPinPose: ApproachPlacedStep | null = null;
  /**
   * The target's arrival: when, the spin's direction then, and how long the
   * start blends from it (0 when no spin frame was drawn).
   */
  let arrival: { at: number; spin: Vec3; blendMs: number } | null = null;
  let spinShown = false;
  /** The camera's direction on the fly-in's first frame, for the smokes. */
  let firstTurn: number[] | null = null;
  /**
   * The camera's distance from the centre (m) on the fly-in's first frame,
   * as the frame loop placed it (`cameraPlaced`), for the smokes; and
   * whether the pose just returned is that first frame's.
   */
  let firstTurnDistanceM: number | null = null;
  let firstTurnPending = false;
  /** A position from the permission rule, and whether none will come. */
  let fix: LatLng | null = null;
  let noFix = false;
  /** A late position blending in: from, to (directions) and since when. */
  let blend: { from: Vec3; to: Vec3; at: number } | null = null;

  const note = (now: number) => {
    history.push({
      phase,
      source: choice.source,
      atMs: Math.round(now - startedAt),
    });
  };
  const restart = (now: number, next: GlobeApproachParams) => {
    params = next;
    startedAt = now;
    phase = "spin";
    choice = { target: null, source: "waiting" };
    history = [];
    runs += 1;
    dive = null;
    pinFlight = null;
    arrival = null;
    spinShown = false;
    firstTurn = null;
    firstTurnDistanceM = null;
    firstTurnPending = false;
    blend = null;
    note(now);
  };
  /** The variant's field of view at the fly-in's start. */
  const startFov = () =>
    introCameraPose(0, {
      variant: params.intro,
      start: [1, 0, 0],
      target: [1, 0, 0],
      startKm: zoomOutM() / 1000,
      endKm: zoomOutM() / 1000,
      endFovDeg: params.fovY,
    }).fovDeg;
  /** The target's direction now, a late fix blending in. */
  const targetDirection = (now: number): Vec3 => {
    if (!blend) return asArray(to.direction);
    const d = blendTarget(
      blend.from,
      blend.to,
      now - blend.at,
      GLOBE_INTRO.lateFixBlendMs,
    );
    if (now - blend.at >= GLOBE_INTRO.lateFixBlendMs) blend = null;
    return d;
  };
  const spinPose = (now: number) =>
    poseToward(
      spinDirection(asArray(sunEcef()), now - startedAt, SPIN_DEG_PER_S),
    );
  /** The fly-in's start now: from the spin to the target's sun side. */
  const startDirection = (now: number, from: NonNullable<typeof arrival>) =>
    flyInStart({
      spin: from.spin,
      target: targetDirection(now),
      sun: asArray(sunEcef()),
      capDeg: params.turnCap,
      sinceArrivalMs: Math.max(0, now - from.at),
      blendMs: from.blendMs,
    });
  /**
   * The spin: a target chosen now starts the fly-in (null returned), else
   * the spin's frame.
   */
  const spinStep = (now: number): ApproachOrbitStep | null => {
    const next = chooseGlobeTarget({
      url: params.url,
      fix,
      fallback: GLOBE_FALLBACK_TARGET,
      fixWaitExpired: noFix || now - startedAt >= params.spinMs,
    });
    if (next.source !== choice.source) {
      choice = next;
      if (next.target) {
        to = orbitPose(ellipsoid, next.target);
        arrival = {
          at: now,
          spin: asArray(spinPose(now).direction),
          blendMs: spinShown ? GLOBE_INTRO.lateFixBlendMs : 0,
        };
        turnStartedAt = now;
        phase = "turning";
      }
      note(now);
    }
    if (phase !== "spin") return null;
    spinShown = true;
    return { pose: spinPose(now), distanceM: zoomOutM(), fovDeg: startFov() };
  };
  /** The fly-in: its frame, or null once it reached the target (`arrived`). */
  const turnStep = (now: number): ApproachOrbitStep | null => {
    const t = params.turnMs > 0 ? (now - turnStartedAt) / params.turnMs : 1;
    if (t >= 1 || !arrival) {
      phase = "arrived";
      note(now);
      return null;
    }
    const p = introCameraPose(t, {
      variant: params.intro,
      start: startDirection(now, arrival),
      target: targetDirection(now),
      startKm: zoomOutM() / 1000,
      endKm: fitDistance() / 1000,
      endFovDeg: params.fovY,
    });
    if (firstTurn === null) {
      firstTurn = [...p.direction];
      firstTurnPending = true;
    }
    return {
      pose: poseToward(p.direction),
      distanceM: p.distanceKm * 1000,
      fovDeg: p.fovDeg,
    };
  };
  /** The spin, the turn and the hold. */
  const introPose = (now: number): ApproachOrbitStep => {
    if (phase === "spin") {
      const spin = spinStep(now);
      if (spin) return spin;
    }
    if (phase === "turning") {
      const turn = turnStep(now);
      if (turn) return turn;
    }
    return {
      pose: blend ? poseToward(targetDirection(now)) : to,
      distanceM: null,
      fovDeg: params.fovY,
    };
  };
  /** The pin flight's camera this frame (a held time for the smokes). */
  const pinPose = (now: number, pin: PinFlight): ApproachStep => {
    if (diveHoldMs !== null && pin.flight) {
      const held = flightCameraAt(pin.flight, diveHoldMs);
      return { position: held.position, quaternion: held.quaternion };
    }
    const out = pinFrame(pin, now);
    pinFlight = out.pin;
    if (out.pin.phase === "landed" && phase === "diving") {
      phase = "landed";
      note(now);
    }
    // A cancelled flight has no camera: it stays where it was last drawn
    // (the binding yields it to the controls at once).
    if (out.camera) {
      lastPinPose = {
        position: out.camera.position,
        quaternion: out.camera.quaternion,
      };
    }
    return lastPinPose ?? introPose(now);
  };
  /** The dive's frame; `landed` once it is done. */
  const diveFrame = (now: number, plan: Dive): ApproachPlacedStep => {
    const step = diveStep(plan, diveHoldMs ?? diveClock(now - diveStartedAt));
    if (step.done && phase === "diving") {
      phase = "landed";
      note(now);
    }
    return step;
  };
  const descending = () => phase === "diving" || phase === "landed";
  /** The fly-in's facts for the smokes, as `state()` reports them. */
  const flyInFacts = () => {
    const at = clockNow();
    return {
      // The fly-in's start as it is now (unit vector, ECEF); null before a
      // target arrived and during the dive.
      flyInStart: arrival && !descending() ? startDirection(at, arrival) : null,
      firstTurn,
      firstTurnDistanceM,
      // How long the start blends from the spin (0: no spin was shown),
      // and whether that blend is over.
      flyInBlendMs: arrival?.blendMs ?? null,
      flyInSettled: arrival ? at - arrival.at >= arrival.blendMs : false,
    };
  };
  const fixState = () => (fix ? "fix" : noFix ? "none" : "waiting");

  return {
    restart,
    /**
     * A position from the permission rule: while the spin waits it becomes
     * the target; while the fallback is flown to or held, the target blends
     * over to it (no jump).
     */
    setFix(next: LatLng, now: number) {
      fix = next;
      if (choice.source !== "fallback") return;
      if (phase !== "turning" && phase !== "arrived") return;
      const toNext = orbitPose(ellipsoid, next);
      blend = {
        from: targetDirection(now),
        to: asArray(toNext.direction),
        at: now,
      };
      to = toNext;
      choice = { target: next, source: "fix" };
      note(now);
    },
    /** No position will come (no granted permission): do not wait for one. */
    noFixComing() {
      noFix = true;
    },
    /**
     * The user took the camera: the intro stops where it is, as the phase
     * `user`, until a restart gives the camera back. The pin flight hears
     * of it too, so its phase says cancelled (every cancel path comes
     * through here).
     */
    yieldToUser(now: number) {
      if (phase === "user") return;
      if (pinFlight) pinFlight = pinTouch(pinFlight, now);
      phase = "user";
      note(now);
    },
    /** Whether the intro drives the camera: every phase but `user`. */
    get drives() {
      return phase !== "user";
    },
    /**
     * The pin's dive: from the camera as it is (`fromPose`: its orbit pose,
     * distance and rotation), turn to `target` and descend to `toAltitudeM`
     * over `durationMs` (`planDive`), then hold there as `landed`. `clock`
     * maps the real elapsed time to the dive's (default: as it is).
     */
    dive(
      now: number,
      target: LatLng,
      fromPose: DiveStart,
      {
        durationMs,
        toAltitudeM,
        clock,
      }: {
        durationMs: number;
        toAltitudeM: number;
        clock?: (elapsedMs: number) => number;
      },
    ) {
      dive = planDive(ellipsoid, fromPose, orbitPose(ellipsoid, target), {
        durationMs,
        toAltitudeM,
        pitchLowDeg: params.pitchLow,
      });
      diveStartedAt = now;
      diveHoldMs = null;
      diveClock = clock ?? ((elapsedMs) => elapsedMs);
      // A pin flight left from `flight=2` (the hash can switch modes
      // without a restart) must not drive this dive's pose (a cancelled
      // one froze the camera).
      pinFlight = null;
      choice = { target, source: "pin" };
      phase = "diving";
      note(now);
    },
    /**
     * The continuous flight (`flight=2`): `pin` (`pressPin`'s) drives the
     * camera from now on, as the dive would; `place` is its target when
     * known (a link), else null until `aimPin`.
     */
    flyPin(now: number, pin: PinFlight, place: LatLng | null = null) {
      pinFlight = pin;
      dive = null;
      diveHoldMs = null;
      choice = { target: place, source: "pin" };
      phase = "diving";
      note(now);
    },
    /** The pin flight's place once the fix names it, for the distance readout. */
    aimPin(place: LatLng) {
      if (pinFlight) choice = { target: place, source: "pin" };
    },
    /** Applies `(pin, now) => pin` to the pin flight (an event), if one. */
    updatePin(now: number, apply: (pin: PinFlight, now: number) => PinFlight) {
      if (pinFlight) pinFlight = apply(pinFlight, now);
    },
    /** The pin flight, or null. */
    get pinFlight() {
      return pinFlight;
    },
    /**
     * For the smokes: hold the camera at a dive time (ms, null to run on),
     * and read the dive's altitude at a time without moving the camera.
     * Null without a dive. With the pin flight the time is its own clock.
     */
    holdDiveAt(ms: number | null): number | null {
      if (pinFlight?.flight) {
        diveHoldMs = ms;
        return flightFrameAt(pinFlight.flight, ms ?? 0).altitudeM;
      }
      if (!dive) return null;
      diveHoldMs = ms;
      return diveStep(dive, ms ?? 0).altitudeM;
    },
    diveAltitudeAt(ms: number): number | null {
      if (pinFlight?.flight) {
        return flightFrameAt(pinFlight.flight, ms).altitudeM;
      }
      return dive ? diveStep(dive, ms).altitudeM : null;
    },
    /** The pose for this frame, advancing the states. */
    pose(now: number): ApproachStep {
      if (pinFlight && descending()) return pinPose(now, pinFlight);
      if (descending() && dive) return diveFrame(now, dive);
      return introPose(now);
    },
    /**
     * The frame loop placed the camera at `distanceM` from the centre:
     * kept when it was the fly-in's first frame.
     */
    cameraPlaced(distanceM: number) {
      if (!firstTurnPending) return;
      firstTurnPending = false;
      firstTurnDistanceM = distanceM;
    },
    state: () => ({
      phase,
      target: choice.target,
      source: choice.source,
      history: history.slice(),
      runs,
      spinMs: params.spinMs,
      turnMs: params.turnMs,
      intro: params.intro,
      fixState: fixState(),
      ...flyInFacts(),
    }),
  };
}

/** The approach, as the lab and its frame loop hold it. */
export type GlobeApproach = ReturnType<typeof createGlobeApproach>;
