/**
 * The generic tracker capture gate: decides, per camera frame, whether any
 * registered tracker (QR codes today; 2D images, 3D objects and keyframes
 * later) wants the frame, and for which of its targets. A tracker searches
 * at its in-gate rate while one of its targets is near (the nearby-targets
 * kernel), at its slow rates otherwise, at its burst rate for a while after
 * a hit, and at its in-gate rate whenever it forces itself on.
 *
 * Stateless per call: the kernel runs over each active tracker's targets
 * with the position source's inputs, and the burst is derived from the
 * tracker's own last hit, so the gate holds no timer. Its one piece of
 * state is the registration list, a resource like a listener list.
 *
 * @see tracker-capture-gate.ts.md
 */

import type { NearbyPosition } from './nearby-position.js';
import {
  DEFAULT_NEARBY_PARAMS,
  checkNearbyParams,
  nearbyTargets,
  timeSlot,
  type NearbyParams,
  type NearbyResult,
  type Target,
  type TargetKind,
} from './nearby-targets.js';

/** A tracker's capture rates (Hz; 0 = off) per situation. */
export interface TrackerCadence {
  /** One of its targets is open. */
  readonly inGateHz: number;
  /** None open while the position is known. */
  readonly outsideHz: number;
  /** The kernel's state is `'unknown'` (a round robin over the targets). */
  readonly unknownHz: number;
  /** After a hit, for `burstMs`. */
  readonly burstHz: number;
  readonly burstMs: number;
}

export interface TrackerRegistration {
  readonly kind: TargetKind;
  /** Its targets, each with this tracker's own sighting (odom-NUE). */
  targets(): readonly Target[];
  readonly cadence: TrackerCadence;
  /** True while it cannot take a frame: then it is skipped. */
  isBusy(): boolean;
  /** Its newest hit, epoch ms (the gate's clock), or null. */
  lastHitAtMs(): number | null;
  /** The in-gate rate regardless of position. */
  forceOn(): boolean;
}

export interface TrackerGateOptions {
  /** The kernel's position inputs at `nowMs`, samples within H only
   *  (`createNearbyPositionSource`). Not called while every tracker is
   *  busy. */
  position(nowMs: number): NearbyPosition;
  /** Default `DEFAULT_NEARBY_PARAMS`. */
  readonly params?: NearbyParams;
  /** The camera source's capture interval (ms): a rate's slot is one
   *  interval wide, so a veto never costs more than the slot. */
  readonly captureIntervalMs: number;
  /** The budget: at most k targets per route. Default 3. */
  readonly k?: number;
}

/** Which tracker a frame goes to, and for which targets. */
export interface FrameRoute {
  readonly kind: TargetKind;
  /** The capped open list, or one target in turn when none is open. */
  readonly targetIds: readonly string[];
}

export interface TrackerCaptureGate {
  /** Adds a tracker; returns its unregister (idempotent).
   *  @throws RangeError on a cadence that is not finite and >= 0. */
  register(tracker: TrackerRegistration): () => void;
  /** Whether any tracker wants this frame. */
  wantsFrame(nowMs: number): boolean;
  /** The routes of this frame; empty when no tracker wants it. */
  kindsFor(nowMs: number): readonly FrameRoute[];
}

/** The default budget k (the plan's 4.6). */
export const DEFAULT_TRACKER_BUDGET_K = 3;

/**
 * Creates the gate.
 *
 * @throws RangeError on a non-positive or non-finite `captureIntervalMs`,
 *   a `k` that is not a positive integer, or bad params.
 */
export function createTrackerCaptureGate(
  options: TrackerGateOptions
): TrackerCaptureGate {
  const intervalMs = options.captureIntervalMs;
  if (!(Number.isFinite(intervalMs) && intervalMs > 0)) {
    throw new RangeError(
      `captureIntervalMs must be finite and > 0; got ${String(intervalMs)}`
    );
  }
  const k = options.k ?? DEFAULT_TRACKER_BUDGET_K;
  if (!Number.isInteger(k) || k <= 0) {
    throw new RangeError(`k must be a positive integer; got ${String(k)}`);
  }
  const params = options.params ?? DEFAULT_NEARBY_PARAMS;
  checkNearbyParams(params);
  const trackers: TrackerRegistration[] = [];

  function kindsFor(nowMs: number): readonly FrameRoute[] {
    if (!Number.isFinite(nowMs)) {
      throw new RangeError(`nowMs must be finite; got ${String(nowMs)}`);
    }
    const active = trackers.filter((t) => !t.isBusy());
    if (active.length === 0) return [];
    const position = options.position(nowMs);
    const routes: FrameRoute[] = [];
    for (const tracker of active) {
      const targets = tracker.targets();
      const result = nearbyTargets({
        targets,
        ...position,
        nowMs,
        params,
      });
      const route = routeOf(tracker, targets, result, nowMs, intervalMs, k);
      if (route !== null) routes.push(route);
    }
    return routes;
  }

  return {
    register(tracker) {
      checkCadence(tracker.cadence);
      trackers.push(tracker);
      // Each registration's own handle: removing it removes that entry
      // only, so a stale handle never removes a later registration of the
      // same tracker.
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        const i = trackers.indexOf(tracker);
        if (i >= 0) trackers.splice(i, 1);
      };
    },
    wantsFrame: (nowMs) => kindsFor(nowMs).length > 0,
    kindsFor,
  };
}

/** One tracker's route at `nowMs`, or null when it wants no frame. */
function routeOf(
  tracker: TrackerRegistration,
  targets: readonly Target[],
  result: NearbyResult,
  nowMs: number,
  intervalMs: number,
  k: number
): FrameRoute | null {
  const c = tracker.cadence;
  const open = result.open.length > 0;
  const baseHz = open
    ? c.inGateHz
    : result.state === 'unknown'
      ? c.unknownHz
      : c.outsideHz;
  const lastHit = tracker.lastHitAtMs();
  const sinceHit =
    lastHit !== null && Number.isFinite(lastHit) ? nowMs - lastHit : -1;
  const rates = [baseHz];
  if (sinceHit >= 0 && sinceHit < c.burstMs) rates.push(c.burstHz);
  if (tracker.forceOn()) rates.push(c.inGateHz);
  // The fastest rate that wants the frame: its period drives the turn, so
  // a burst inside the slow rate's slot still turns per capture.
  const wanting = rates.filter((r) => inSlot(r, nowMs, intervalMs));
  if (wanting.length === 0) return null;
  const hz = Math.max(...wanting);
  const periodMs = Math.max(1000 / hz, intervalMs);
  const targetIds = open
    ? capped(
        result.open.map((o) => o.key),
        k,
        nowMs,
        periodMs
      )
    : inTurn(targets, nowMs, periodMs);
  return { kind: tracker.kind, targetIds };
}

/** Whether a rate of `hz` wants the frame at `nowMs`: its slot is the
 *  first interval of each period; a period of at most one interval is
 *  every frame, 0 Hz never. The slot is one capture interval wide: a frame
 *  source that asks less often than once per interval (below 8 fps at
 *  125 ms) can step over a slow rate's slot and skip that period. */
function inSlot(hz: number, nowMs: number, intervalMs: number): boolean {
  if (hz <= 0) return false;
  const periodMs = 1000 / hz;
  if (periodMs <= intervalMs) return true;
  const into = ((nowMs % periodMs) + periodMs) % periodMs;
  return into < intervalMs;
}

/** The nearest ceil(k/2) open keys always, the rest of the budget in turn
 *  over the others (a time-derived, mixed slot, no cursor). */
function capped(
  keys: readonly string[],
  k: number,
  nowMs: number,
  periodMs: number
): string[] {
  if (keys.length <= k) return [...keys];
  const fixed = Math.ceil(k / 2);
  const rest = keys.slice(fixed);
  const start = timeSlot(nowMs, periodMs, rest.length);
  const turn: string[] = [];
  for (let i = 0; i < k - fixed; i += 1) {
    turn.push(rest[(start + i) % rest.length]!);
  }
  return [...keys.slice(0, fixed), ...turn];
}

/** One target in turn, by key order, or none without targets. */
function inTurn(
  targets: readonly Target[],
  nowMs: number,
  periodMs: number
): string[] {
  const keys = targets
    .map((t) => t.key)
    .filter((key) => typeof key === 'string')
    .sort();
  if (keys.length === 0) return [];
  return [keys[timeSlot(nowMs, periodMs, keys.length)]!];
}

function checkCadence(c: TrackerCadence): void {
  for (const name of [
    'inGateHz',
    'outsideHz',
    'unknownHz',
    'burstHz',
    'burstMs',
  ] as const) {
    const v = c[name];
    if (!(Number.isFinite(v) && v >= 0)) {
      throw new RangeError(
        `cadence.${name} must be finite and >= 0; got ${String(v)}`
      );
    }
  }
}
