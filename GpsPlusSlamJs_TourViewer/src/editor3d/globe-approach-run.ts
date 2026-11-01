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
 *   the 3D view, the camera kept where it is): the stations pop in from
 *   then, then the walk draws itself. A landed bar stays full for
 *   `BAR_DONE_MS` so its finish is seen; a taken one goes at once.
 * - The line stays while anything is still loading and fades out once
 *   nothing has been for a hold (`LINE_HOLD_MS`); a load meanwhile
 *   cancels the fade. `LINE_CAP_MS` after the arrival it goes whatever
 *   still loads.
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
  APPROACH_TITLE,
  approachLine,
  createLineHold,
  LINE_HOLD_MS,
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

/** How long a landed bar stays full before it goes (ms): long enough to
 *  be seen to finish (a few frames would be missed), short enough not to
 *  read as a second wait. */
export const BAR_DONE_MS = 300;

/**
 * The line's end, however much still loads (ms after the arrival). Weighed
 * over 5 to 20 s: at 5 s it would leave while a phone on a slow link is
 * plainly still filling in the ground, so the scene would look finished
 * and broken at once; at 20 s a box over the view outstays the opening
 * the creator is already working in. 10 s covers a normal load and ends
 * a hung one. Not measured on a device.
 */
export const LINE_CAP_MS = 10_000;

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
  /** The arrival's timing (the short one under reduced motion). */
  readonly timing: ArrivalTiming;
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
 * arrival and no fade. `lineCapMs` replaces `LINE_CAP_MS` (the page's
 * checks only, which render slowly in software).
 */
export function createApproachRun(deps: {
  readonly box: HTMLElement;
  readonly flight: ApproachFlight;
  readonly startMs?: number;
  readonly reducedMotion: boolean;
  readonly lineCapMs?: number | undefined;
}): ApproachRun {
  const { box, reducedMotion } = deps;
  const lineCapMs = deps.lineCapMs ?? LINE_CAP_MS;
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
  /** Since when nothing has been pending; null while something is. */
  let quietSince: number | null = null;
  const hold = createLineHold();

  const root = document.createElement("div");
  root.className = "approach";
  root.dataset["phase"] = "flying";
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
  const line = document.createElement("div");
  line.className = "approach-line";
  line.setAttribute("role", "status");
  line.setAttribute("aria-live", "polite");
  root.append(title, track, line);
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

  /** The bar and its title go: at once after a takeover, a beat after a
   *  landing (the bar finishes when the camera lands). */
  const barDone = (nowMs: number) =>
    phase === "arrived" &&
    (ended === "taken" || nowMs - arrivedAt >= BAR_DONE_MS);

  /** Whether the line should go: never while the bar shows, at the cap
   *  after the arrival, or once nothing has been pending for a hold. */
  const lineQuiet = (nowMs: number) =>
    track.hidden &&
    (nowMs - arrivedAt >= lineCapMs ||
      (quietSince !== null && nowMs - quietSince >= LINE_HOLD_MS));

  /** The line shown: a fade under way is cancelled. While flying it
   *  follows what is named (blank when nothing is); after the arrival it
   *  keeps its last words until it goes. */
  const showLine = (nowMs: number, words: ApproachLine | null) => {
    lineGoneAt = null;
    root.classList.remove("gone");
    const wanted = phase === "flying" ? words : (words ?? hold.shown);
    const shown = hold.step(nowMs, wanted) ?? "";
    if (line.textContent !== shown) line.textContent = shown;
  };

  /** The line fading, then gone. The words stay while it fades; the live
   *  region is not told twice. */
  const fadeLine = (nowMs: number) => {
    if (lineGoneAt === null) {
      lineGoneAt = nowMs;
      root.classList.add("gone");
    }
    if (nowMs - lineGoneAt >= (reducedMotion ? 0 : LINE_FADE_MS)) {
      root.hidden = true;
    }
  };

  return {
    timing,
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
      if (!track.hidden && barDone(nowMs)) {
        track.hidden = true;
        title.hidden = true;
        root.dataset["phase"] = "arrived";
      }
      // Once gone, the line stays gone: what loads as the creator moves
      // about later is no part of the opening.
      if (root.hidden === true) return;
      const words = approachLine(pending);
      if (words !== null) quietSince = null;
      else quietSince ??= nowMs;
      if (lineQuiet(nowMs)) fadeLine(nowMs);
      else showLine(nowMs, words);
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
        line: root.hidden === true || lineGoneAt !== null ? null : hold.shown,
        retargets,
        durationMs: deps.flight.durationMs,
      };
    },
    dispose() {
      root.remove();
    },
  };
}
