/**
 * One approach on opening a tour in the globe editor: the flight (an
 * `ApproachDriver`, the globe's own meteor flight in the page:
 * `globe-approach-meteor.ts`), the thin accent line under the top bar
 * that fills with the camera's fall (the box), and the arrival's pop-in
 * and walk (`approach-arrival.ts`), driven by the view's frame loop. No
 * WebGL: the view lets it drive the camera each frame and asks it for each
 * station's growth, and tells it the camera's altitude.
 *
 * - Flying: `drive` has the flight place the camera (its first call
 *   starts the flight), the line follows the camera's height, a progress
 *   bar named "Loading tour", and the stations are held back
 *   (`holdsStations`).
 * - The camera lands, or the creator takes it (`takeOver`: an input in
 *   the 3D view, the camera kept where it is): the stations pop in from
 *   then, then the walk draws itself. The line shows full; a landed load
 *   ends `BAR_DONE_MS` later (so its finish is seen as a load), a taken
 *   one at once. The line never goes: once the load is over it stays,
 *   full, as the view's accent line (the docks hang under it), and is no
 *   progress bar any more (no role, hidden from a screen reader). What
 *   still loads does not keep the load going.
 * - `retarget` (a station picked in the list mid-flight) sends the flight
 *   to it from where the camera is; after the flight it does nothing.
 *
 * @see globe-approach-run.ts.md
 */
import {
  ARRIVAL,
  ARRIVAL_REDUCED,
  arrivalDone,
  stationPop,
  walkShare,
  type ArrivalTiming,
  type StationPop,
} from "./approach-arrival.js";

/** The line's accessible name while it loads. */
export const APPROACH_TITLE = "Loading tour";

/** How long a landed line stays a full progress bar before the load ends
 *  (ms): long enough to be seen to finish (a few frames would be missed),
 *  short enough not to read as a second wait. */
export const BAR_DONE_MS = 300;

type ApproachPhase = "flying" | "arrived";

/** How an approach ended: the camera landed, or the creator took it. */
type ApproachEnd = "landed" | "taken";

interface ApproachRunStats {
  readonly phase: ApproachPhase;
  /** Whether the flight still moves the camera. */
  readonly flying: boolean;
  /** How the flight ended: landed, taken by the creator, or null while
   *  flying. */
  readonly ended: ApproachEnd | null;
  /** The line's value (0 to 1), null once the load is over (the line
   *  then stays, full). */
  readonly progress: number | null;
  /** How many times the flight was sent to a station. */
  readonly retargets: number;
  /** The first flight's length (ms; 0 for a cut). */
  readonly durationMs: number;
}

/** A place, degrees. */
interface Place {
  readonly lat: number;
  readonly lng: number;
}

/**
 * The flight a run drives: it places the camera itself (no pose goes
 * through the run, so nothing sets the view's frame each frame).
 */
export interface ApproachDriver {
  /** The first flight's length at a full pace (ms; 0: a cut to its end). */
  readonly durationMs: number;
  /** The first drawn frame: the flight's clock starts. */
  start(nowMs: number): void;
  /** Places the camera for `nowMs`; false from the frame it lands on. */
  drive(nowMs: number): boolean;
  /** A new leg to `place` (landing over `groundM`, m over the ellipsoid)
   *  from the camera as it is. */
  retarget(place: Place, groundM: number): void;
  /** The creator took the camera: the flight stops. */
  takeOver(nowMs: number): void;
  /** The bar's value (0 to 1) for a camera at `altitudeKm`. */
  bar(altitudeKm: number): number;
}

export interface ApproachRun {
  /** The arrival's timing (the short one under reduced motion). */
  readonly timing: ArrivalTiming;
  /** Each frame, before the controls: while flying the flight places the
   *  camera (the first call starts its clock) and true is returned; else
   *  false (the camera is the controls'). */
  drive(nowMs: number): boolean;
  /** Each frame, after the camera is placed: its altitude (km over the
   *  ellipsoid). */
  step(nowMs: number, altitudeKm: number): void;
  /** The creator's input in the 3D view: the flight stops where it is. */
  takeOver(nowMs: number): void;
  /** Send the flight to `place` (its ground `groundM`) from where the
   *  camera is; false after the flight (the caller places the camera
   *  itself). */
  retarget(place: Place, groundM: number): boolean;
  /** Whether the stations are held back from drawing (while flying). */
  holdsStations(): boolean;
  /** The `index`th station's growth at `nowMs`, null when the arrival
   *  is over or has not begun (draw it as it is). */
  pop(index: number, nowMs: number): StationPop | null;
  /** The share of the walk drawn at `nowMs` for `stations` stations (1
   *  once the arrival is over, 0 before it). */
  walk(nowMs: number, stations: number): number;
  /** Whether nothing is left to animate: the arrival is over and the
   *  load has ended (the full line stays until `dispose`). */
  finished(nowMs: number, stations: number): boolean;
  stats(): ApproachRunStats;
  dispose(): void;
}

/**
 * The approach flown by `driver` (started by the first `drive`), its line
 * in `box` (the 3D view's box). `reducedMotion` takes the short arrival.
 * `onDone` is called once, when the load ends (a beat after a landing, at
 * once after a takeover), with how the flight ended; never when disposed
 * before.
 */
export function createApproachRun(deps: {
  readonly box: HTMLElement;
  readonly driver: ApproachDriver;
  readonly reducedMotion: boolean;
  readonly onDone?: (how: ApproachEnd) => void;
}): ApproachRun {
  const { box, driver, reducedMotion } = deps;
  const timing = reducedMotion ? ARRIVAL_REDUCED : ARRIVAL;
  let started = false;
  /** Whether the flight placed its last camera (it lands at the next step). */
  let landedNow = false;
  let phase: ApproachPhase = "flying";
  let ended: ApproachRunStats["ended"] = null;
  let arrivedAt = Number.NaN;
  let progress = 0;
  let retargets = 0;
  /** Whether the load is over: the line full, no progress bar any more. */
  let done = false;

  const root = document.createElement("div");
  root.className = "approach";
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
  root.append(track);
  box.append(root);

  const showProgress = (k: number) => {
    progress = Math.max(progress, k);
    fill.style.transform = `scaleX(${progress.toFixed(4)})`;
    track.setAttribute("aria-valuenow", String(Math.round(progress * 100)));
  };
  showProgress(0);

  const arrive = (nowMs: number, how: ApproachEnd) => {
    if (phase !== "flying") return;
    phase = "arrived";
    ended = how;
    arrivedAt = nowMs;
    // Landed or taken, the approach is over: the line shows full.
    showProgress(1);
  };

  /** The load ends: at once after a takeover, a beat after a landing (the
   *  line finishes when the camera lands). */
  const loadOver = (nowMs: number) =>
    phase === "arrived" &&
    (ended === "taken" || nowMs - arrivedAt >= BAR_DONE_MS);

  /** The line stays, full, but is no progress bar any more. */
  const endLoad = () => {
    done = true;
    for (const name of [
      "role",
      "aria-label",
      "aria-valuemin",
      "aria-valuemax",
      "aria-valuenow",
    ]) {
      track.removeAttribute(name);
    }
    root.setAttribute("aria-hidden", "true");
  };

  return {
    timing,
    drive(nowMs) {
      if (phase !== "flying") return false;
      if (!started) {
        started = true;
        driver.start(nowMs);
      }
      if (!driver.drive(nowMs)) landedNow = true;
      return true;
    },
    step(nowMs, altitudeKm) {
      if (phase === "flying") {
        if (landedNow) arrive(nowMs, "landed");
        else showProgress(driver.bar(altitudeKm));
      }
      if (!done && loadOver(nowMs)) {
        endLoad();
        if (ended !== null) deps.onDone?.(ended);
      }
    },
    takeOver(nowMs) {
      if (phase === "flying") driver.takeOver(nowMs);
      arrive(nowMs, "taken");
    },
    retarget(place, groundM) {
      if (phase !== "flying") return false;
      driver.retarget(place, groundM);
      landedNow = false;
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
        done
      );
    },
    stats() {
      return {
        phase,
        flying: phase === "flying",
        ended,
        progress: done ? null : progress,
        retargets,
        durationMs: driver.durationMs,
      };
    },
    dispose() {
      root.remove();
    },
  };
}
