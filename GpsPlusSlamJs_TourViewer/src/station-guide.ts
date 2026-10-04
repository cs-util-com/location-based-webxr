/**
 * The visitor's stations in AR (tour kit plan K4, §4.2, K-D6, K-D9): runs
 * the station run (`station-run.ts`) from the visitor's position, points the
 * wayfinding HUD at the offered stations, writes the station line, offers
 * the labelled "skip, I can't get there" (§8 D5), and hands a found station
 * to its story. The visitor stays in AR the whole tour (K-D9): nothing here
 * ends the session.
 *
 * - **Where a station is (D19, §8 D8):** its own geo pose; a station with
 *   only a code stands where that code's level was saved. Its pose was fixed
 *   when it was authored (D33's settle, K6a); the viewer only reads it.
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
import { Vector3 } from "three";

import { objectPoseNue } from "./content-placement.js";
import type { StagePose } from "./scene-stage.js";
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
  /** A one-line note of what just happened ("Skipped the well."). */
  let note: string | null = null;
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
    const geo =
      station.anchor.geo ??
      (station.anchor.code === undefined
        ? undefined
        : deps.tour()?.levels?.get(station.anchor.code)?.qr.geo);
    return geo === undefined ? null : objectPoseNue(geo, zero);
  }

  /** Measure once: the visitor, the zero, every station's pose and
   *  horizontal distance. */
  function measure(): void {
    poseCache.clear();
    measuredZero = deps.zero();
    const visitor = deps.visitor();
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

  function handle(events: readonly StationEvent[]): void {
    for (const event of events) {
      if (event.kind === "found") {
        const station = stationById(event.id);
        if (station !== undefined) deps.onFound(station);
      } else if (event.kind === "done") {
        deps.onDone?.(event.id);
      }
    }
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
    show(dom.line, lineText());
    const focus = focusStation();
    if (run === null || focus === null) {
      show(dom.skip, "");
      skipArmedFor = null;
      return;
    }
    if (skipArmedFor !== null && skipArmedFor !== focus) skipArmedFor = null;
    const ripe = skipArmedFor === focus || run.skipSuggested(focus, deps.now());
    show(
      dom.skip,
      ripe
        ? `Skip ${stationTitle(stationById(focus)!)} - I can't get there`
        : "Can't get there?",
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
      handle(
        current.observe({
          distances,
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
      handle(current.codeLocked(levelId, deps.now()));
      render();
    },
    storyEnded(stationId) {
      if (run === null) return;
      handle(run.finish(stationId, deps.now()));
      note = null;
      render();
    },
    skipTapped() {
      const focus = focusStation();
      if (run === null || focus === null) return;
      if (skipArmedFor !== focus && !run.skipSuggested(focus, deps.now())) {
        // On demand: the first tap asks, the second skips.
        skipArmedFor = focus;
        render();
        return;
      }
      const title = stationTitle(stationById(focus)!);
      handle(run.skip(focus, deps.now()));
      skipArmedFor = null;
      note = `Skipped ${title}.`;
      render();
    },
    endSession() {
      hud?.dispose();
      hud = null;
      replayFound = true;
      deps.onGuide?.(null, null);
      dom.line.hidden = true;
      dom.skip.hidden = true;
    },
    poseOf,
  };
}
