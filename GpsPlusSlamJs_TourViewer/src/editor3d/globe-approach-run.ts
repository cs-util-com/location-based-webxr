/**
 * One approach on opening a tour in the globe editor: the flight
 * (`globe-approach-flight.ts`), the bar under the top bar with its
 * "Loading tour" tab hanging from its middle (the box), and the arrival's pop-in and walk (`approach-arrival.ts`), driven
 * by the view's frame loop. No WebGL: the view asks it for the camera's
 * pose each frame and for each station's growth, and tells it the
 * camera's altitude.
 *
 * - Flying: `poseAt` gives the camera's pose, the bar follows the
 *   camera's height, the stations are held back (`holdsStations`).
 * - The camera lands, or the creator takes it (`takeOver`: an input in
 *   the 3D view, the camera kept where it is): the stations pop in from
 *   then, then the walk draws itself. A landed bar stays full for
 *   `BAR_DONE_MS` so its finish is seen, then the box goes; after a
 *   takeover it goes at once. What still loads does not keep it: the box
 *   says only "Loading tour" (the detail line under it is gone).
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
  type ArrivalTiming,
  type StationPop,
} from "./approach-arrival.js";
import {
  barValue,
  flightDone,
  flightPoseAt,
  retargetFlight,
  type ApproachFlight,
} from "./globe-approach-flight.js";

/** The tab's words, and the bar's accessible name. */
export const APPROACH_TITLE = "Loading tour";

/** How long a landed bar stays full before it goes (ms): long enough to
 *  be seen to finish (a few frames would be missed), short enough not to
 *  read as a second wait. */
export const BAR_DONE_MS = 300;

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
  /** How many times the flight was sent to a station. */
  readonly retargets: number;
  /** The first flight's length (ms). */
  readonly durationMs: number;
}

export interface ApproachRun {
  /** The arrival's timing (the short one under reduced motion). */
  readonly timing: ArrivalTiming;
  /** Start the flight's clock at `nowMs` (the first drawn frame); later
   *  calls do nothing. Given `startMs`, the run is started already. */
  start(nowMs: number): void;
  /** The camera's pose at `nowMs` while flying (its first pose before
   *  `start`), else null (the camera is the controls'). */
  poseAt(nowMs: number): GlobeViewPose | null;
  /** Each frame, after the camera is placed: its altitude (km over the
   *  ellipsoid). */
  step(nowMs: number, altitudeKm: number): void;
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
  /** Whether nothing is left to animate or show: the arrival is over and
   *  the box is gone. */
  finished(nowMs: number, stations: number): boolean;
  stats(): ApproachRunStats;
  dispose(): void;
}

/**
 * The approach `flight`, begun at `startMs` (or at `start`), its title and
 * bar in `box` (the 3D view's box). `reducedMotion` takes the short
 * arrival. `onDone` is called once, when the bar goes (a beat after a
 * landing, at once after a takeover); never when disposed before.
 */
export function createApproachRun(deps: {
  readonly box: HTMLElement;
  readonly flight: ApproachFlight;
  readonly startMs?: number;
  readonly reducedMotion: boolean;
  readonly onDone?: () => void;
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

  const root = document.createElement("div");
  root.className = "approach";
  // The progress bar carries the same words as its label, so the title
  // is not read twice.
  const title = document.createElement("div");
  title.className = "approach-title";
  title.setAttribute("aria-hidden", "true");
  title.textContent = APPROACH_TITLE;
  const track = document.createElement("div");
  track.className = "approach-track";
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-label", APPROACH_TITLE);
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "100");
  track.setAttribute("aria-valuenow", "0");
  const fill = document.createElement("div");
  fill.className = "approach-fill";
  track.append(fill);
  // The bar first, its tab hanging under it.
  root.append(track, title);
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
  };

  /** The box goes: at once after a takeover, a beat after a landing (the
   *  bar finishes when the camera lands). */
  const barDone = (nowMs: number) =>
    phase === "arrived" &&
    (ended === "taken" || nowMs - arrivedAt >= BAR_DONE_MS);

  return {
    timing,
    start(nowMs) {
      flightStart ??= nowMs;
    },
    poseAt(nowMs) {
      if (phase !== "flying") return null;
      return flightPoseAt(flight, flightMs(nowMs));
    },
    step(nowMs, altitudeKm) {
      if (phase === "flying") {
        if (flightDone(flight, flightMs(nowMs))) arrive(nowMs, "landed");
        else showProgress(barValue(flight, altitudeKm));
      }
      if (root.hidden !== true && barDone(nowMs)) {
        root.hidden = true;
        deps.onDone?.();
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
        progress: root.hidden === true ? null : progress,
        retargets,
        durationMs: deps.flight.durationMs,
      };
    },
    dispose() {
      root.remove();
    },
  };
}
