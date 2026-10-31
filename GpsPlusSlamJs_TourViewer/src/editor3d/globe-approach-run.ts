/**
 * One approach on opening a tour in the globe editor: the flight
 * (`globe-approach-flight.ts`), the bar and the quiet line over the view
 * (`approach-status.ts`), and the arrival's pop-in and walk
 * (`approach-arrival.ts`), driven by the view's frame loop. No WebGL: the
 * view asks it for the camera's pose each frame and for each station's
 * growth, and tells it what is still loading.
 *
 * - Flying: `poseAt` gives the camera's pose, the bar follows the
 *   camera's height, the stations are held back (`holdsStations`).
 * - The camera lands, or the creator takes it (`takeOver`: an input in
 *   the 3D view, the camera kept where it is): the bar goes, the
 *   stations pop in from then, then the walk draws itself.
 * - The line stays while anything is still loading and fades out once
 *   nothing is.
 * - `retarget` (a station picked in the list mid-flight) sends the flight
 *   to it from where the camera is; after the flight it does nothing.
 *
 * @see globe-approach-run.ts.md
 */
import type { GlobeViewPose } from "gps-plus-slam-globe/view";

import {
  ARRIVAL,
  ARRIVAL_REDUCED,
  arrivalDone,
  stationPop,
  walkShare,
  type StationPop,
} from "./approach-arrival.js";
import {
  approachLine,
  createLineHold,
  type ApproachLine,
  type ApproachPending,
} from "./approach-status.js";
import {
  barValue,
  flightDone,
  flightPoseAt,
  retargetFlight,
  type ApproachFlight,
} from "./globe-approach-flight.js";

/** How long the line takes to fade out (ms), as its CSS transition. */
export const LINE_FADE_MS = 400;

type ApproachPhase = "flying" | "arrived";

interface ApproachRunStats {
  readonly phase: ApproachPhase;
  /** Whether the flight still moves the camera. */
  readonly flying: boolean;
  /** How the flight ended: landed, taken by the creator, or null while
   *  flying. */
  readonly ended: "landed" | "taken" | null;
  /** The bar's value (0 to 1), null once the bar is gone. */
  readonly progress: number | null;
  /** The line's words, null once it is gone. */
  readonly line: ApproachLine | null;
  /** How many times the flight was sent to a station. */
  readonly retargets: number;
  /** The first flight's length (ms). */
  readonly durationMs: number;
}

export interface ApproachRun {
  /** Start the flight's clock at `nowMs` (the first drawn frame); later
   *  calls do nothing. Given `startMs`, the run is started already. */
  start(nowMs: number): void;
  /** The camera's pose at `nowMs` while flying (its first pose before
   *  `start`), else null (the camera is the controls'). */
  poseAt(nowMs: number): GlobeViewPose | null;
  /** Each frame, after the camera is placed: its altitude (km over the
   *  ellipsoid) and what is still loading. */
  step(nowMs: number, altitudeKm: number, pending: ApproachPending): void;
  /** The creator's input in the 3D view: the flight stops where it is. */
  takeOver(nowMs: number): void;
  /** Send the flight to `goal` from `now`, the camera's pose; false after
   *  the flight (the caller places the camera itself). */
  retarget(
    nowMs: number,
    now: GlobeViewPose,
    goal: GlobeViewPose,
    groundM: number,
  ): boolean;
  /** Whether the stations are held back from drawing (while flying). */
  holdsStations(): boolean;
  /** The `index`th station's growth at `nowMs`, null when the arrival
   *  is over or has not begun (draw it as it is). */
  pop(index: number, nowMs: number): StationPop | null;
  /** The share of the walk drawn at `nowMs` for `stations` stations (1
   *  once the arrival is over, 0 before it). */
  walk(nowMs: number, stations: number): number;
  /** Whether nothing is left to animate or show. */
  finished(nowMs: number, stations: number): boolean;
  stats(): ApproachRunStats;
  dispose(): void;
}

/**
 * The approach `flight`, begun at `startMs` (or at `start`), its bar and
 * line in `box` (the 3D view's box). `reducedMotion` takes the short
 * arrival and no fade.
 */
export function createApproachRun(deps: {
  readonly box: HTMLElement;
  readonly flight: ApproachFlight;
  readonly startMs?: number;
  readonly reducedMotion: boolean;
}): ApproachRun {
  const { box, reducedMotion } = deps;
  const timing = reducedMotion ? ARRIVAL_REDUCED : ARRIVAL;
  let flight = deps.flight;
  /** When the flight's clock started; null before `start`. */
  let flightStart: number | null = deps.startMs ?? null;
  /** The flight's time at `nowMs` (0 before its start). */
  const flightMs = (nowMs: number) =>
    flightStart === null ? 0 : nowMs - flightStart;
  let phase: ApproachPhase = "flying";
  let ended: ApproachRunStats["ended"] = null;
  let arrivedAt = Number.NaN;
  let progress = 0;
  let retargets = 0;
  let lineGoneAt: number | null = null;
  const hold = createLineHold();

  const root = document.createElement("div");
  root.className = "approach";
  root.dataset["phase"] = "flying";
  const track = document.createElement("div");
  track.className = "approach-track";
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-label", "Loading tour");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "100");
  track.setAttribute("aria-valuenow", "0");
  const fill = document.createElement("div");
  fill.className = "approach-fill";
  track.append(fill);
  const line = document.createElement("div");
  line.className = "approach-line";
  line.setAttribute("role", "status");
  line.setAttribute("aria-live", "polite");
  root.append(track, line);
  box.append(root);

  const showProgress = (k: number) => {
    progress = Math.max(progress, k);
    fill.style.transform = `scaleX(${progress.toFixed(4)})`;
    track.setAttribute("aria-valuenow", String(Math.round(progress * 100)));
  };
  showProgress(0);

  const arrive = (nowMs: number, how: "landed" | "taken") => {
    if (phase !== "flying") return;
    phase = "arrived";
    ended = how;
    arrivedAt = nowMs;
    if (how === "landed") showProgress(1);
    root.dataset["phase"] = "arrived";
    track.hidden = true;
  };

  return {
    start(nowMs) {
      flightStart ??= nowMs;
    },
    poseAt(nowMs) {
      if (phase !== "flying") return null;
      return flightPoseAt(flight, flightMs(nowMs));
    },
    step(nowMs, altitudeKm, pending) {
      if (phase === "flying") {
        if (flightDone(flight, flightMs(nowMs))) arrive(nowMs, "landed");
        else showProgress(barValue(flight, altitudeKm));
      }
      // Once gone, the line stays gone: what loads as the creator moves
      // about later is no part of the opening.
      if (root.hidden === true) return;
      const shown = hold.step(nowMs, approachLine(pending, phase === "flying"));
      if (shown !== null) {
        lineGoneAt = null;
        if (line.textContent !== shown) line.textContent = shown;
        root.classList.remove("gone");
      } else if (lineGoneAt === null) {
        // The words stay while the line fades; the live region is not
        // told twice.
        lineGoneAt = nowMs;
        root.classList.add("gone");
      }
      if (
        lineGoneAt !== null &&
        nowMs - lineGoneAt >= (reducedMotion ? 0 : LINE_FADE_MS)
      ) {
        root.hidden = true;
      }
    },
    takeOver(nowMs) {
      arrive(nowMs, "taken");
    },
    retarget(nowMs, now, goal, groundM) {
      if (phase !== "flying") return false;
      flight = retargetFlight(flight, now, flightMs(nowMs), goal, groundM);
      flightStart = nowMs;
      retargets++;
      return true;
    },
    holdsStations: () => phase === "flying",
    pop(index, nowMs) {
      if (phase === "flying") return null;
      const t = nowMs - arrivedAt;
      return stationPop(t, index, timing);
    },
    walk(nowMs, stations) {
      if (phase === "flying") return 0;
      return walkShare(nowMs - arrivedAt, stations, timing);
    },
    finished(nowMs, stations) {
      return (
        phase === "arrived" &&
        arrivalDone(nowMs - arrivedAt, stations, timing) &&
        root.hidden === true
      );
    },
    stats() {
      return {
        phase,
        flying: phase === "flying",
        ended,
        progress: track.hidden === true ? null : progress,
        line: root.hidden === true ? null : hold.shown,
        retargets,
        durationMs: deps.flight.durationMs,
      };
    },
    dispose() {
      root.remove();
    },
  };
}
