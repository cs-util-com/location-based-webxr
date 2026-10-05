/**
 * The visitor's stations in AR (tour kit plan K4, §4.2, K-D6, K-D9): runs
 * the station run (`station-run.ts`) from the visitor's position, points the
 * wayfinding HUD at the offered stations, writes the station line, offers
 * the labelled "skip, I can't get there" (§8 D5), and hands a found station
 * to its story. The visitor stays in AR the whole tour (K-D9): nothing here
 * ends the session.
 *
 * - **Where a station is (D19, §8 D8):** its own geo pose; a station with
 *   only a code stands where that code's level was saved - on the estimated
 *   ground below it, turned about the vertical only (K4 review R6). Its
 *   pose was fixed when it was authored (D33's settle, K6a); the viewer
 *   only reads it.
 * - **Found by its code:** a lock of the station's code counts, unless the
 *   moved-code check ignores that code (D20, §8 D8: a moved code is not a
 *   "found you").
 * - **The HUD's arrival is the found radius** (`station-bands.ts`, §8 D9):
 *   each target's `distanceMin`/`distanceMax` are the station's found band at
 *   the measured accuracy, and the target sits at the visitor's own height so
 *   the HUD's distance is the horizontal one the run judges.
 * - **Progress lives as long as the tour stays open** (several AR entries;
 *   saving it across page lives is K3). A different tour starts a new run.
 */

import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type {
  TourOrder,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-stations";
import type { LatLong } from "gps-plus-slam-app-framework/core";
import type { WayfindingTarget } from "gps-plus-slam-app-framework/visualization/wayfinding-targets";
import { formatDistance } from "gps-plus-slam-app-framework/utils/format-distance";
import { DEFAULT_TOAST_LINGER_MS } from "gps-plus-slam-app-framework/utils/toast-core";
import { Quaternion, Vector3 } from "three";

import { EYE_HEIGHT_M } from "./breadcrumbs.js";
import { objectPoseNue, rotationFromHeading } from "./content-placement.js";
import type { StagePose } from "./scene-stage.js";
import { CODE_MOVE_RULE } from "./code-displacement.js";
import { ACCURACY_CEILING_M, stationBands } from "./station-bands.js";
import {
  createStationRun,
  stationTitle,
  type StationEvent,
  type StationRun,
} from "./station-run.js";
import type { VisitorPosition } from "./visitor-position.js";

/** The station line and the skip button, inside `#ar-root`. */
export interface StationGuideDom {
  readonly line: Pick<HTMLElement, "textContent" | "hidden">;
  readonly skip: Pick<HTMLElement, "textContent" | "hidden">;
}

/** The open tour's stations, as the guide reads them each tick. */
export interface StationTour {
  readonly stations: readonly TourStation[];
  readonly order: TourOrder;
  /** The tour's printed codes by level id (a code-only station's spot). */
  readonly levels: ReadonlyMap<string, QrLevel> | null;
}

export interface StationGuideDeps {
  readonly dom: StationGuideDom;
  /** The open tour's stations, or null (no tour, no stations, not read). */
  tour(): StationTour | null;
  /** Whether the tour's content may be placed now (a visitor's session
   *  with the scan gate passed or not required). */
  placementAllowed(): boolean;
  zero(): LatLong | null;
  visitor(): VisitorPosition;
  /** The moved-code check ignores this level id (D20). */
  isIgnoredCode(levelId: string): boolean;
  /** The moved-code check of this level id, while it runs: `judged` once
   *  its rule has had the evidence to read a move (`moved-code-check.ts`
   *  `checkHadItsWindow`); null when no check runs for it (none pinned
   *  yet, or it ended). Absent: no check is consulted (K4 review R1). */
  codeCheck?(levelId: string): { readonly judged: boolean } | null;
  /** Start the HUD for this AR session; null while it cannot (no camera
   *  yet). The guide retries on the next tick. */
  startHud(getTargets: () => WayfindingTarget[]): { dispose(): void } | null;
  now(): number;
  /** A station was found: play its story. */
  onFound(station: TourStation): void;
  /** Each tick, for each offered station with a distance: how far it is,
   *  and its activation radius (the prefetch starts its lead beyond it). */
  onApproach?(station: TourStation, distanceM: number, activateM: number): void;
  /** A station is done (its story ended, or it was skipped). */
  onDone?(stationId: string): void;
  /** End a found station's story now (the visitor asked, K4 review R9):
   *  the story panel stops it and reports its end (`storyEnded`). Absent:
   *  the guide marks the station done itself. */
  onEndStory?(stationId: string): void;
  /** Every render while the current station's story plays under a fixed
   *  or branch order: the station that comes next (the prefetch reads it
   *  ahead, K4 review R5). */
  onUpcoming?(station: TourStation): void;
  /** Every tick with a position: the stage turns its figure to the visitor. */
  onVisitor?(nue: readonly [number, number, number]): void;
  /** The breadcrumbs: from the visitor towards the station in focus,
   *  stopping at its arrival band; a null target (or visitor) clears them. */
  onGuide?(
    visitor: readonly [number, number, number] | null,
    target: {
      readonly id: string;
      readonly to: readonly [number, number, number];
      readonly stopM: number;
    } | null,
  ): void;
}

export interface StationGuide {
  /** Re-judge: a GPS fix, a store change or a camera frame. Cheap. */
  tick(): void;
  /** A printed code locked in AR (its level id). */
  codeLocked(levelId: string): void;
  /** A station's story played to its end. */
  storyEnded(stationId: string): void;
  /** The skip button. */
  skipTapped(): void;
  /** The AR session ended: the HUD goes; the progress stays. */
  endSession(): void;
  /** A station's pose at the scene root, or null (no zero, no spot). */
  poseOf(stationId: string): StagePose | null;
}

/**
 * A code's turn about the vertical alone (K4 review R6: a model at a
 * code-only station took the poster's tilt): its compat heading where the
 * code has one, else the bearing of its rotated local +x (the heading's
 * own definition), else of its local +z less 90 degrees; none: no turn.
 */
function yawOnly(geo: {
  readonly headingDeg?: number;
  readonly rotation?: readonly [number, number, number, number];
}): readonly [number, number, number, number] {
  if (geo.headingDeg !== undefined) return rotationFromHeading(geo.headingDeg);
  if (geo.rotation === undefined) return [0, 0, 0, 1];
  const q = new Quaternion(...geo.rotation);
  const x = new Vector3(1, 0, 0).applyQuaternion(q);
  if (Math.hypot(x.x, x.z) > 1e-6) {
    return rotationFromHeading((Math.atan2(x.z, x.x) * 180) / Math.PI);
  }
  const z = new Vector3(0, 0, 1).applyQuaternion(q);
  if (Math.hypot(z.x, z.z) > 1e-6) {
    return rotationFromHeading((Math.atan2(z.z, z.x) * 180) / Math.PI - 90);
  }
  return [0, 0, 0, 1];
}

/**
 * How long a skip can be undone (K4 review R14): the framework's toast
 * linger (6 s), so it reads like every other transient message. Argued,
 * not measured: 3 s is about the time to read "Skipped X. Next: Y, 80 m"
 * (8 words at 4 words a second) and react; 10 s would hold the next
 * station's skip back that long. Reversed by a field test showing stray
 * skips noticed later than 6 s, or visitors waiting on the undo.
 */
export const SKIP_UNDO_MS = DEFAULT_TOAST_LINGER_MS;

/**
 * How long a code lock the visitor's own GPS disagrees with is held at most
 * before it finds its station anyway (K4 review R1): the moved-code rule's
 * minimum evidence span (60 s, `CODE_MOVE_RULE.minSpanS`) - the earliest a
 * check started at the lock can read a move when the visitor had no GPS
 * history before it - plus 15 s for late or missed fixes. A hold usually
 * ends much sooner: the check counts the device fixes of the 300 s before
 * the lock too, so after a walk it has its evidence at the first fix. Swept
 * in `station-code-hold.sweep.test.ts`: scanning at once, a 40 m move is
 * vetoed 60 s after the pin, so 60 s ties with the veto and 30 or 45 s
 * release the moved poster first; 75 s or more catch it. The hold outlasts
 * the check only for a visitor who stands still (under 2 m of spread) or
 * has no fixes; a longer hold makes them wait longer at a correct poster.
 */
export const CODE_HOLD_MAX_MS = (CODE_MOVE_RULE.minSpanS + 15) * 1000;

/** What a tap on the skip button does (its label says which). */
interface SkipAction {
  readonly kind: "ask-skip" | "skip" | "ask-end" | "end" | "undo";
  readonly id: string;
}

/** Whole metres: GPS-guided distances are not more precise than that. */
function distanceText(m: number): string {
  return formatDistance(m, { metreDecimals: 0 });
}

export function wireStationGuide(deps: StationGuideDeps): StationGuide {
  const { dom } = deps;
  let run: StationRun | null = null;
  let runStations: readonly TourStation[] | null = null;
  let hud: { dispose(): void } | null = null;
  /** The session ended: a found station's story was cut short and plays
   *  again on the next session's first tick. */
  let replayFound = false;
  /** The visitor asked for the skip ("Can't get there?"), for this id. */
  let skipArmedFor: string | null = null;
  /** What the skip button showed at the last render: a tap does that. */
  let rendered: SkipAction | null = null;
  /** The last skip while it can be undone (R14); its "done" reaches the
   *  prefetch only when the moment passes or the tour moves on. */
  let undoable: { id: string; untilMs: number } | null = null;
  /** Stations a code lock would find but the visitor's own GPS does not
   *  agree with (K4 review R1): held, and not found by GPS either (the
   *  code's votes pull the fused position onto its saved spot), until the
   *  moved-code check has had its evidence, the code is vetoed (then the
   *  hold is dropped), or `CODE_HOLD_MAX_MS` passed. */
  const held = new Map<string, { levelId: string; sinceMs: number }>();
  /** A one-line note of what just happened ("Skipped the well."). */
  let note: string | null = null;
  /** The note goes with the moment a skip can be undone (R14). */
  let noteUntilMs = 0;
  /** The last measurement: the visitor, and every placeable station's
   *  horizontal distance (all stations, so an offer that changes between
   *  ticks has its distances already). Taken once per tick (K4 review R13). */
  let last: {
    visitor: VisitorPosition;
    distances: Map<string, number>;
  } | null = null;
  /** Station poses at the last measurement's zero, computed once each per
   *  measurement (R13: the geodesy ran several times per station a tick). */
  const poseCache = new Map<string, StagePose | null>();
  let measuredZero: LatLong | null | undefined;
  let measuredVisitor: VisitorPosition | null = null;

  function stationById(id: string): TourStation | undefined {
    return runStations?.find((s) => s.id === id);
  }

  function poseOf(stationId: string): StagePose | null {
    const cached = poseCache.get(stationId);
    if (cached !== undefined) return cached;
    const pose = computePose(stationId);
    poseCache.set(stationId, pose);
    return pose;
  }

  function computePose(stationId: string): StagePose | null {
    const zero = measuredZero === undefined ? deps.zero() : measuredZero;
    const station = stationById(stationId);
    if (zero === null || station === undefined) return null;
    if (station.anchor.geo !== undefined) {
      return objectPoseNue(station.anchor.geo, zero);
    }
    const code =
      station.anchor.code === undefined
        ? undefined
        : deps.tour()?.levels?.get(station.anchor.code)?.qr.geo;
    if (code === undefined) return null;
    // A code-only station (K4 review R6): on the estimated ground below the
    // code - the visitor's height less the breadcrumbs' eye height - and
    // turned about the vertical only. A poster's centre hangs 1-2 m up a
    // wall, and its tilt is no way for a figure or a model to stand.
    const eye = measuredVisitor?.nue ?? null;
    if (eye === null) return null;
    const at = objectPoseNue(code, zero);
    return {
      positionNue: [
        at.positionNue[0],
        eye[1] - EYE_HEIGHT_M,
        at.positionNue[2],
      ],
      rotationNue: yawOnly(code),
    };
  }

  /** Measure once: the visitor, the zero, every station's pose and
   *  horizontal distance. */
  function measure(): void {
    poseCache.clear();
    measuredZero = deps.zero();
    const visitor = deps.visitor();
    measuredVisitor = visitor;
    last = { visitor, distances: horizontalDistances(visitor.nue) };
  }

  /** The run for the open tour, created once the tour may be placed. */
  function currentRun(): StationRun | null {
    const tour = deps.tour();
    if (tour === null || tour.stations.length === 0) {
      run = null;
      runStations = null;
      return null;
    }
    if (tour.stations !== runStations) {
      if (!deps.placementAllowed()) return null;
      runStations = tour.stations;
      run = createStationRun({
        stations: tour.stations,
        order: tour.order,
        nowMs: deps.now(),
      });
      skipArmedFor = null;
      rendered = null;
      undoable = null;
      held.clear();
      note = null;
    }
    return run;
  }

  function horizontalDistances(
    nue: readonly [number, number, number] | null,
  ): Map<string, number> {
    const out = new Map<string, number>();
    if (nue === null || runStations === null) return out;
    for (const { id } of runStations) {
      const pose = poseOf(id);
      if (pose === null) continue;
      out.set(
        id,
        Math.hypot(pose.positionNue[0] - nue[0], pose.positionNue[2] - nue[2]),
      );
    }
    return out;
  }

  /**
   * Whether a lock of this station's code may find it now (R1): the latest
   * raw device fix (never moved by a vote) is inside the station's
   * activation radius at the measured accuracy - or there is nothing
   * independent to judge by (no usable fix, or no spot), as for the
   * moved-code check itself.
   */
  function codeAgrees(stationId: string): boolean {
    const station = stationById(stationId);
    const visitor = last?.visitor;
    const accuracy = visitor?.accuracyM ?? null;
    if (
      station === undefined ||
      visitor?.fixNue == null ||
      accuracy === null ||
      !(accuracy > 0 && accuracy <= ACCURACY_CEILING_M)
    ) {
      return true;
    }
    const spot = poseOf(stationId);
    if (spot === null) return true;
    const d = Math.hypot(
      spot.positionNue[0] - visitor.fixNue[0],
      spot.positionNue[2] - visitor.fixNue[2],
    );
    return d <= stationBands(station, accuracy).activateM;
  }

  /** Release held code locks whose hold is over (R1). */
  function releaseHeld(current: StationRun): void {
    for (const [id, h] of [...held]) {
      const status = current.status(id);
      if (deps.isIgnoredCode(h.levelId) || status?.state !== "waiting") {
        // Vetoed (its votes were taken back), or done another way.
        held.delete(id);
        continue;
      }
      const judged = deps.codeCheck?.(h.levelId)?.judged === true;
      if (
        judged ||
        deps.now() - h.sinceMs >= CODE_HOLD_MAX_MS ||
        codeAgrees(id)
      ) {
        held.delete(id);
        handle(current.codeLocked(h.levelId, deps.now(), (s) => s === id));
      }
    }
  }

  function handle(events: readonly StationEvent[]): void {
    for (const event of events) {
      if (event.kind === "found") {
        // Another station moved on: the last skip stays as it is.
        settleUndo();
        const station = stationById(event.id);
        if (station !== undefined) deps.onFound(station);
      } else if (event.kind === "done") {
        // A skip that can still be undone reaches the prefetch later.
        if (event.skipped && undoable?.id === event.id) continue;
        settleUndo();
        deps.onDone?.(event.id);
      }
    }
  }

  /** The last skip can no longer be undone: tell the prefetch it is done. */
  function settleUndo(): void {
    if (undoable === null) return;
    const id = undoable.id;
    undoable = null;
    deps.onDone?.(id);
  }

  /** The prefetch's view of the offer: each offered station's distance. */
  function approach(
    distances: ReadonlyMap<string, number>,
    accuracyM: number | null,
  ): void {
    if (deps.onApproach === undefined || run === null) return;
    for (const id of run.offered()) {
      const d = distances.get(id);
      const station = stationById(id);
      if (d === undefined || station === undefined) continue;
      deps.onApproach(station, d, stationBands(station, accuracyM).activateM);
    }
  }

  /** The offered station the skip and the line are about: the nearest
   *  one not yet found (the first in list order without a distance). */
  function focusStation(): string | null {
    if (run === null) return null;
    const unfound = run
      .offered()
      .filter((id) => run?.status(id)?.state !== "found");
    if (unfound.length === 0) return null;
    const distances = last?.distances ?? new Map<string, number>();
    return [...unfound].sort(
      (a, b) => (distances.get(a) ?? Infinity) - (distances.get(b) ?? Infinity),
    )[0]!;
  }

  function hudTargets(): WayfindingTarget[] {
    if (run === null || last === null || last.visitor.nue === null) return [];
    const eyeHeight = last.visitor.nue[1];
    const targets: WayfindingTarget[] = [];
    for (const id of run.offered()) {
      const status = run.status(id);
      const station = stationById(id);
      const pose = poseOf(id);
      if (status?.state === "found" || station === undefined || pose === null) {
        continue;
      }
      const bands = stationBands(station, last.visitor.accuracyM);
      targets.push({
        id,
        position: new Vector3(
          pose.positionNue[0],
          eyeHeight,
          pose.positionNue[2],
        ),
        distanceMin: bands.foundM,
        distanceMax: bands.foundExitM,
      });
    }
    return targets;
  }

  function lineText(): string {
    if (run === null) return "";
    if (run.isComplete()) {
      const skipped = run.statuses().filter((s) => s.skipped).length;
      // A branch tour ends with its path; the other branches' stations
      // were never offered, so "every station" would be false (R16).
      if (deps.tour()?.order === "branch") {
        return skipped === 0
          ? "Tour complete - you reached the end of your path."
          : `Tour complete - you reached the end of your path, ${String(skipped)} skipped.`;
      }
      return skipped === 0
        ? "Tour complete - every station visited."
        : `Tour complete - ${String(skipped)} skipped.`;
    }
    const lead = note === null ? "" : `${note} `;
    const focus = focusStation();
    if (focus === null) return `${lead}Station found - its story is playing.`;
    const station = stationById(focus)!;
    const title = stationTitle(station);
    const visitor = last?.visitor;
    const d = last?.distances.get(focus);
    const waiting =
      run.offered().length > 1
        ? `${String(run.offered().length)} stations to find - nearest: ${title}`
        : `Next: ${title}`;
    if (visitor === undefined || visitor.nue === null) {
      return `${lead}${waiting} - waiting for your position…`;
    }
    if (visitor.accuracyM !== null && visitor.accuracyM > ACCURACY_CEILING_M) {
      return `${lead}${waiting} - GPS too weak to guide you (±${distanceText(visitor.accuracyM)}); step into the open.`;
    }
    if (held.has(focus)) return `${lead}${waiting} - checking its code…`;
    if (d === undefined) {
      return `${lead}${waiting} - find its printed code.`;
    }
    return `${lead}${waiting}, ${distanceText(d)}`;
  }

  /** Write a text only when it changed (R13: the line is a polite live
   *  region, and a rewrite is announced again). */
  function show(
    el: Pick<HTMLElement, "textContent" | "hidden">,
    text: string,
  ): void {
    if (el.textContent !== text) el.textContent = text;
    const hidden = text === "";
    if (el.hidden !== hidden) el.hidden = hidden;
  }

  function render(): void {
    // A code lock can find a station before the guide has ticked at all.
    if (last === null) measure();
    const visitor = last!.visitor;
    deps.onGuide?.(visitor.nue, guideTarget());
    const upcoming = run?.upcoming() ?? null;
    const next = upcoming === null ? undefined : stationById(upcoming);
    if (next !== undefined) deps.onUpcoming?.(next);
    if (run?.isComplete() === true) {
      // Nothing left to point at, whichever action completed the tour.
      hud?.dispose();
      hud = null;
    } else {
      // Whichever action brought the run here (a tick, a code lock).
      ensureHud();
    }
    if (undoable !== null && deps.now() >= undoable.untilMs) settleUndo();
    if (note !== null && deps.now() >= noteUntilMs) note = null;
    show(dom.line, lineText());
    rendered = skipAction();
    show(dom.skip, rendered === null ? "" : skipLabel(rendered));
  }

  /** What the skip button offers now. The station in focus starts its skip
   *  clock here, when it becomes the focus (K4 review R14). */
  function skipAction(): SkipAction | null {
    if (run === null) return null;
    const focus = focusStation();
    if (focus !== null) {
      run.focus(focus, deps.now(), last?.distances.get(focus) ?? null);
    }
    // A skip that can still be undone: the button undoes it (R14).
    if (undoable !== null) return { kind: "undo", id: undoable.id };
    const story = focus === null ? storyFocus() : null;
    const target = focus ?? story;
    if (target === null) {
      skipArmedFor = null;
      return null;
    }
    if (skipArmedFor !== null && skipArmedFor !== target) skipArmedFor = null;
    if (story !== null) {
      // Nothing unfound is offered: the button ends the story playing, so
      // one that never ends cannot hold the tour (K4 review R9).
      return { kind: skipArmedFor === story ? "end" : "ask-end", id: story };
    }
    const ripe =
      skipArmedFor === target || run.skipSuggested(target, deps.now());
    return { kind: ripe ? "skip" : "ask-skip", id: target };
  }

  function skipLabel(action: SkipAction): string {
    const title = stationTitle(stationById(action.id)!);
    switch (action.kind) {
      case "ask-skip":
        return "Can't get there?";
      case "skip":
        return `Skip ${title} - I can't get there`;
      case "ask-end":
        return "End this story?";
      case "end":
        return `End the story of ${title} now`;
      case "undo":
        return `Undo: bring back ${title}`;
    }
  }

  /** When no unfound station is offered: the found offered station whose
   *  story the visitor may end (the first in list order), else null. */
  function storyFocus(): string | null {
    if (run === null) return null;
    return (
      run.offered().find((id) => run?.status(id)?.state === "found") ?? null
    );
  }

  /** The breadcrumbs' target: the station in focus, by its spot. */
  function guideTarget(): {
    id: string;
    to: readonly [number, number, number];
    stopM: number;
  } | null {
    const focus = focusStation();
    if (focus === null || last === null) return null;
    const pose = poseOf(focus);
    const station = stationById(focus);
    if (pose === null || station === undefined) return null;
    return {
      id: focus,
      to: pose.positionNue,
      stopM: stationBands(station, last.visitor.accuracyM).foundExitM,
    };
  }

  function ensureHud(): void {
    if (hud !== null || run === null || run.isComplete()) return;
    hud = deps.startHud(hudTargets);
  }

  return {
    tick() {
      const current = currentRun();
      // The scan gate is checked every tick, not only when the run was
      // created (K4 review R8): a later AR session waits behind its own.
      if (current === null || !deps.placementAllowed()) {
        show(dom.line, "");
        show(dom.skip, "");
        deps.onGuide?.(null, null);
        return;
      }
      measure();
      const { visitor, distances } = last!;
      // A story cut short by the session's end plays again once it can be
      // placed: a position and the GPS zero (R8: before them its figure had
      // no pose).
      if (replayFound && measuredZero !== null && visitor.nue !== null) {
        replayFound = false;
        for (const status of current.statuses()) {
          const station = stationById(status.id);
          if (status.state === "found" && station !== undefined) {
            deps.onFound(station);
          }
        }
      }
      if (visitor.nue !== null) deps.onVisitor?.(visitor.nue);
      approach(distances, visitor.accuracyM);
      releaseHeld(current);
      // A held station is not found by GPS either: the code's votes pull
      // the fused position onto its saved spot (R1).
      const judged = new Map(distances);
      for (const id of held.keys()) judged.delete(id);
      handle(
        current.observe({
          distances: judged,
          accuracyM: visitor.accuracyM,
          nowMs: deps.now(),
        }),
      );
      render();
    },
    codeLocked(levelId) {
      const current = currentRun();
      if (
        current === null ||
        !deps.placementAllowed() ||
        deps.isIgnoredCode(levelId)
      ) {
        return;
      }
      if (last === null) measure();
      handle(
        current.codeLocked(levelId, deps.now(), (id) => {
          if (held.has(id)) return false;
          if (codeAgrees(id)) return true;
          held.set(id, { levelId, sinceMs: deps.now() });
          return false;
        }),
      );
      render();
    },
    storyEnded(stationId) {
      if (run === null) return;
      handle(run.finish(stationId, deps.now()));
      note = null;
      render();
    },
    skipTapped() {
      // The tap does what the label showed, for the station it named (R14):
      // a clock that ran out since, or a focus that moved, changes nothing.
      const action = rendered;
      if (run === null || action === null) return;
      const title = stationTitle(stationById(action.id)!);
      switch (action.kind) {
        case "ask-skip":
        case "ask-end":
          // On demand: the first tap asks, the second acts.
          skipArmedFor = action.id;
          break;
        case "skip":
          skipArmedFor = null;
          undoable = { id: action.id, untilMs: deps.now() + SKIP_UNDO_MS };
          handle(run.skip(action.id, deps.now()));
          note = `Skipped ${title}.`;
          noteUntilMs = deps.now() + SKIP_UNDO_MS;
          break;
        case "end":
          skipArmedFor = null;
          if (deps.onEndStory !== undefined) {
            // The story panel ends it and reports back (`storyEnded`).
            deps.onEndStory(action.id);
            return;
          }
          handle(run.finish(action.id, deps.now()));
          break;
        case "undo":
          if (undoable?.id !== action.id) break;
          undoable = null;
          handle(run.unskip(action.id, deps.now()));
          note = `Brought back ${title}.`;
          noteUntilMs = deps.now() + SKIP_UNDO_MS;
          break;
      }
      render();
    },
    endSession() {
      hud?.dispose();
      hud = null;
      replayFound = true;
      // The moved-code checks are per AR entry: a hold ends with its
      // session, and the code must lock again in the next (R1).
      held.clear();
      deps.onGuide?.(null, null);
      dom.line.hidden = true;
      dom.skip.hidden = true;
    },
    poseOf,
  };
}
