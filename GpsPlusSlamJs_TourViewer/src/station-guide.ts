/**
 * The visitor's stations in AR (tour kit plan K4, §4.2, K-D6, K-D9): runs
 * the station run (`station-run.ts`) from the visitor's position, points the
 * wayfinding HUD at the offered stations, writes the station line, offers
 * the labelled "skip, I can't get there" (§8 D5), and hands a found station
 * to its story. The visitor stays in AR the whole tour (K-D9): nothing here
 * ends the session.
 *
 * - **Where a station is (D19, §8 D8; tour editor plan D9):** its own geo
 *   pose, as a pin's. Its pose was fixed when it was authored (D33's
 *   settle, K6a); the viewer only reads it. Since version 3 every station
 *   has one (D9: no code-only station).
 * - **Reached by its radius alone (D16):** the phone's current best
 *   position - the alignment's, fed by GPS and codes alike, while it is
 *   ready (`alignmentReady`, re-read each tick); while it is not (it
 *   starts as the identity at the first fix, with no heading, and a
 *   GPS-only session whose tracking quality drops is not ready any more)
 *   or there is no alignment at all, the latest device fix if it is fresh
 *   (`FIX_MAX_AGE_MS`) - inside the station's found radius. Only while the
 *   session stays ready (a code lined it up) is a dropped camera pose no
 *   position at all (M5a review M3). What needs a heading - the HUD's
 *   arrows, the breadcrumbs, the figure's pose and its turn - waits for the
 *   first readiness of each AR entry and keeps a heading tracking earned
 *   through a dip (r881 re-review L-B, M-B); a heading only a code gave
 *   goes with the code (third review L2), and tracking ready while a code
 *   is lined up does not latch, since the code's votes feed that report.
 *   A code lock is no arrival: it only improves that position, and the
 *   guide re-judges at once. With no position nothing is reached. A moved
 *   poster can pull the position onto a station until the moved-code
 *   check has judged it (its evidence window); from then on the check
 *   ignores its code and takes its votes back (`isIgnored` of the
 *   viewer pipeline, `qr-viewer-mode.ts`, D20), the one guard left since
 *   the lock-hold went (review 2 #5). Inside that window a visitor who
 *   scans a moved poster near another station may find it early.
 * - **Judged by the raw fixes' accuracy unless a code lined it up**
 *   (`station-bands.ts` `judgedAccuracy`, `judgedStationBands`): the
 *   median of the latest fixes, and for a lone fix standing in for the
 *   position the worse of that and the fix's own (r881 re-review M-A).
 *   Above the ceiling the line says the GPS is too weak and nothing is
 *   found (PR #640 review); the aligned position a code lined up is
 *   trusted whatever the fixes say (M5c review #1). Being aligned alone
 *   earns no trust: the library aligns a session from its first fix, at
 *   any accuracy.
 * - **The HUD's arrival is the found radius** (`station-bands.ts`, §8 D9):
 *   each target's `distanceMin`/`distanceMax` are the station's found band at
 *   the measured accuracy, and the target sits at the visitor's own height so
 *   the HUD's distance is the horizontal one the run judges.
 * - **One gate for found and presence** (visitor plan 2026-10-18-2349 §3):
 *   the same judged position, judged accuracy, `tooWeakToGuide` and
 *   readiness decide the story's arrival and the station whose content
 *   shows (`station-presence.ts`), in one function (`judged`), so the two
 *   never disagree. Presence reads every station, not the offer (V-D5); it
 *   lives in the page's store (`visitor-guide-slice.ts`), dispatched only
 *   when it changes and after the tick's own work, holds with no position
 *   (a tracking drop, a stale fix), clears at the session's end and resets
 *   with another tour. Not a hold (PR review S1): a fix too weak to guide
 *   by still ends it past the exit by its accuracy, and a station a code
 *   made present ends when the code goes and nothing else can judge (a
 *   moved poster's veto).
 * - **The wait for a heading is said** (D34 of the tour editor plan): while
 *   the guide has stations to point at and no heading yet this AR entry,
 *   the store's `headingPending` is true and the visitor's status line
 *   asks for a few steps (`visitor-status.ts`); the figure keeps waiting.
 * - **Progress lives as long as the tour stays open** (several AR entries;
 *   saving it across page lives is K3). A different tour starts a new run.
 */

import type {
  TourOrder,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-stations";
import type { LatLong } from "gps-plus-slam-app-framework/core";
import type { WayfindingTarget } from "gps-plus-slam-app-framework/visualization/wayfinding-targets";
import { formatDistance } from "gps-plus-slam-app-framework/utils/format-distance";
import { DEFAULT_TOAST_LINGER_MS } from "gps-plus-slam-app-framework/utils/toast-core";
import { Vector3 } from "three";

import { objectPoseNue } from "./content-placement.js";
import type { StagePose } from "./scene-stage.js";
import {
  judgedAccuracy,
  judgedStationBands,
  tooWeakToGuide,
  type StationBands,
} from "./station-bands.js";
import {
  createStationRun,
  stationTitle,
  type StationEvent,
  type StationRun,
} from "./station-run.js";
import { presenceCandidates } from "./station-presence.js";
import {
  guideTourChanged,
  headingPendingSet,
  presenceAfter,
  presenceCleared,
  presenceJudged,
  type PresenceJudgement,
  type VisitorGuideStore,
} from "./visitor-guide-slice.js";
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
  /** Whether a code lined the alignment up (`tour-flow.ts` `codeLinedUp`):
   *  its position is then trusted whatever the raw fixes' accuracy says. */
  codeLinedUp(): boolean;
  /** Whether the alignment may be judged on now (`tour-flow.ts`
   *  `alignmentReady`: tracking ready, or a code lined it up; re-read each
   *  tick). While it is not, the fresh device fix stands in, as before any
   *  alignment, judged by the worse of the median and its own accuracy.
   *  What needs a heading (the arrows, the breadcrumbs, the figure) waits
   *  for its first `true` of each AR entry and keeps it through a dip. */
  alignmentReady(): boolean;
  /** Whether the tracking report reads ready (`tour-flow.ts`
   *  `isPlacementReady`; re-read each tick). It latches a heading for the
   *  AR entry only while no code is lined up: a lined-up code's votes feed
   *  the report, so a heading only a code gave goes with the code. */
  trackingReady(): boolean;
  /** Start the HUD for this AR session; null while it cannot (no camera
   *  yet). The guide retries on the next tick. */
  startHud(getTargets: () => WayfindingTarget[]): { dispose(): void } | null;
  now(): number;
  /** The oldest a device fix may be to stand in for the position (no
   *  alignment, or one not ready; ms, on `now`'s clock); default
   *  `FIX_MAX_AGE_MS`. */
  readonly fixMaxAgeMs?: number;
  /** The page's store, where the visitor's present station lives
   *  (`visitor-guide-slice.ts`): the guide dispatches a judged position
   *  only when it changes the answer. Absent: no presence is judged. */
  readonly guideStore?: VisitorGuideStore;
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
  /** Every tick with a camera position, once this AR entry's alignment was
   *  ready (a heading): the stage turns its figure to the visitor. */
  onVisitor?(nue: readonly [number, number, number]): void;
  /** The breadcrumbs: from the visitor towards the station in focus,
   *  stopping at its arrival band; a null target (or visitor) clears them.
   *  The visitor is null until this AR entry's alignment was ready. */
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
  /** A printed code locked in AR: no arrival of its own (D16), only a
   *  re-judge now, since the lock improved the position. */
  codeLocked(): void;
  /** A station's story played to its end. */
  storyEnded(stationId: string): void;
  /** The skip button. */
  skipTapped(): void;
  /** The AR session ended: the HUD goes; the progress stays. */
  endSession(): void;
  /** A station's pose at the scene root, or null (no zero yet). */
  poseOf(stationId: string): StagePose | null;
  /** Where the stage stands a story's figure: the station's pose once
   *  this AR entry's alignment was ready, null before (no heading yet:
   *  the figure would stand up to 180° off, then jump; the stage waits,
   *  r881 re-review M-B). */
  figurePoseOf(stationId: string): StagePose | null;
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
 * The oldest a device fix may be to stand in for the visitor's position
 * (no alignment, or one not ready; M5a review M3), against the fix's own Geolocation
 * time. Argued, not measured: Android delivers about one fix a second, so
 * 5 s tolerates four missed fixes, and a visitor walking 1.4 m/s has moved
 * about 7 m since - about a typical fix's own accuracy, and more than a
 * small station's found radius, so an older fix says where the visitor WAS.
 * 2-10 s are swept in the tests: below 2 s an ordinary gap between fixes
 * would blank the position; above 10 s the drift (14 m) exceeds most found
 * radii. Reversed by field data showing fix gaps over 5 s in normal walking.
 */
export const FIX_MAX_AGE_MS = 5_000;

/**
 * How many stations the HUD marks at once: the nearest unfound offered
 * ones (visitor plan 2026-10-18-2349, the owner's "where the closest five
 * stations are"). Under the `any` order a town walk offers every station,
 * and a marker for each would crowd the view; the sweep in
 * `station-guide.hud.test.ts` counts the markers inside the field of view
 * for 3-10. No distance cap: a cap would leave a visitor far from every
 * station with no marker at all.
 */
export const HUD_NEAREST_STATIONS = 5;

/** One measurement of the visitor, taken once per tick (K4 review R13). */
interface Measurement {
  /** The visitor; while the alignment is not ready (`alignmentReady`)
   *  it counts as unaligned: no camera position, the fresh fix stands in. */
  readonly visitor: VisitorPosition;
  /** The best position this measurement judged by (`bestPosition`). */
  readonly best: readonly [number, number, number] | null;
  /** The raw fixes' accuracy for `best`: their median, and for a lone
   *  fix the worse of that and the fix's own (r881 re-review M-A: one
   *  ±40 m fix after a ±5 m run hid behind the median). */
  readonly rawAccuracyM: number | null;
  /** A code lined the alignment up and `best` is the aligned position:
   *  trusted whatever the raw fixes' accuracy (`judgedAccuracy`), through
   *  a tracking drop too (r881 review L1: the line must not call it too
   *  weak then); never for a lone raw fix (re-review L-A). */
  readonly codeLinedUp: boolean;
  /** The camera position for what needs a heading (the HUD's arrows, the
   *  breadcrumbs, the figure's turn): once this AR entry's alignment was
   *  ready, null before (r881 re-review L-B: no flicker in a dip). */
  readonly headingNue: readonly [number, number, number] | null;
  /** Every placeable station's horizontal distance from `best`. */
  readonly distances: Map<string, number>;
}

/** What one tick may judge (`judged`): the arrival and presence alike. */
interface Judgement {
  readonly distances: ReadonlyMap<string, number>;
  /** The judged accuracy (`judgedAccuracy`; null: a code lined it up). */
  readonly accuracyM: number | null;
}

/** What a tap on the skip button does (its label says which). */
interface SkipAction {
  readonly kind: "ask-skip" | "skip" | "ask-end" | "end" | "undo";
  readonly id: string;
}

/**
 * The `count` items nearest by `distanceOf` (undefined: farthest), kept
 * in their own order; ties go to the earlier item. Exported for the HUD's
 * tests.
 */
export function nearestOf<T>(
  items: readonly T[],
  count: number,
  distanceOf: (item: T) => number | undefined,
): T[] {
  if (items.length <= count) return [...items];
  const keep = new Set(
    items
      .map((item, index) => ({ index, d: distanceOf(item) ?? Infinity }))
      .sort((a, b) => a.d - b.d || a.index - b.index)
      .slice(0, Math.max(0, count))
      .map((e) => e.index),
  );
  return items.filter((_, index) => keep.has(index));
}

/** Whole metres: GPS-guided distances are not more precise than that. */
function distanceText(m: number): string {
  return formatDistance(m, { metreDecimals: 0 });
}

export function wireStationGuide(deps: StationGuideDeps): StationGuide {
  const { dom } = deps;
  const fixMaxAgeMs = deps.fixMaxAgeMs ?? FIX_MAX_AGE_MS;
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
  /** A one-line note of what just happened ("Skipped the well."). */
  let note: string | null = null;
  /** The note goes with the moment a skip can be undone (R14). */
  let noteUntilMs = 0;
  /** The last measurement: the visitor, and every placeable station's
   *  horizontal distance from the best position (all stations, so an offer
   *  that changes between ticks has its distances already). Taken once per
   *  tick (K4 review R13). */
  let last: Measurement | null = null;
  /** Station poses at the last measurement's zero, computed once each per
   *  measurement (R13: the geodesy ran several times per station a tick). */
  const poseCache = new Map<string, StagePose | null>();
  let measuredZero: LatLong | null | undefined;
  /** Tracking was ready once this AR entry with no code lined up
   *  (`trackingReady` while not `codeLinedUp`): it earned a heading, kept
   *  through a dip of the tracking quality, as the walk's photos latch
   *  their trigger. Reset at the session's end. */
  let trackedHeading = false;
  /** The alignment has a heading now: tracking earned one this AR entry,
   *  or it is ready now (a code lined it up). A heading only a code gave
   *  goes with the code's votes (a veto) while tracking is not ready
   *  (r881 third review L2). */
  let headingReady = false;
  /** The run was replaced or dropped (another tour, or none; never the
   *  first run): the store's presence and its "show all" reset at the end
   *  of the tick. */
  let tourChangePending = false;
  /** The present station was last judged on a position a code lined up:
   *  once the code goes (a veto) and nothing else can judge, it ends. */
  let presentByCode = false;

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
    return objectPoseNue(station.geo, zero);
  }

  /** Whether the alignment has a heading this tick (`headingReady`):
   *  tracking earned one this AR entry, or it is ready now. Tracking ready
   *  while a code is lined up does not latch: the code's votes feed the
   *  tracking report, so that `ok` can be the code's own work. Once the
   *  votes are gone, a report still `ok` latches on that tick. */
  function noteHeading(
    ready: boolean,
    tracking: boolean,
    lined: boolean,
  ): void {
    if (tracking && !lined) trackedHeading = true;
    headingReady = trackedHeading || ready;
  }

  /** Measure once: the visitor, the zero, every station's pose and
   *  horizontal distance. An alignment that is not ready now counts as
   *  none (`alignmentReady`): the fresh device fix stands in, judged by
   *  the worse of the median and its own accuracy (r881 review H1:
   *  readiness needs a walk with turns, and a visitor standing at a
   *  station had no guidance at all; re-review M-A). Only an aligned
   *  position a code lined up is trusted (`codeLinedUp`). */
  function measure(): void {
    poseCache.clear();
    measuredZero = deps.zero();
    const seen = deps.visitor();
    const ready = deps.alignmentReady();
    const lined = deps.codeLinedUp();
    noteHeading(ready, deps.trackingReady(), lined);
    const visitor =
      seen.aligned && !ready ? { ...seen, nue: null, aligned: false } : seen;
    const position = bestPosition(visitor);
    const best = position?.nue ?? null;
    last = {
      visitor,
      best,
      rawAccuracyM: rawAccuracyFor(visitor, position?.loneFix === true),
      codeLinedUp: visitor.aligned && lined,
      headingNue: headingReady ? seen.nue : null,
      distances: horizontalDistances(best),
    };
  }

  /** The run for the open tour, created once the tour may be placed. */
  function currentRun(): StationRun | null {
    const tour = deps.tour();
    if (tour === null || tour.stations.length === 0) {
      if (run !== null) tourChangePending = true;
      run = null;
      runStations = null;
      return null;
    }
    if (tour.stations !== runStations) {
      if (!deps.placementAllowed()) return null;
      // The page's first tour is no change: a "show all" set before the
      // first tick stays (PR review S5).
      if (runStations !== null) tourChangePending = true;
      runStations = tour.stations;
      run = createStationRun({
        stations: tour.stations,
        order: tour.order,
        nowMs: deps.now(),
      });
      skipArmedFor = null;
      rendered = null;
      undoable = null;
      note = null;
    }
    return run;
  }

  /** The phone's current best position (D16): the alignment's, else -
   *  only while the visitor counts as unaligned (no alignment, or one not
   *  ready, `measure`) - the latest device fix, if it is fresh, as a
   *  lone fix; null otherwise. A session still ready whose camera pose
   *  dropped has no position until it is back: the raw fix would bypass
   *  the trust that keeps it ready and could latch "found" (M5a review
   *  M3). */
  function bestPosition(
    visitor: VisitorPosition,
  ): { nue: readonly [number, number, number]; loneFix: boolean } | null {
    if (visitor.nue !== null) return { nue: visitor.nue, loneFix: false };
    if (visitor.aligned || visitor.fixNue === null) return null;
    const at = visitor.fixAtMs;
    if (at === null || !Number.isFinite(at)) return null;
    return deps.now() - at <= fixMaxAgeMs
      ? { nue: visitor.fixNue, loneFix: true }
      : null;
  }

  /** The accuracy that speaks for the position judged by
   *  (`judgedAccuracy`): the raw fixes' (`rawAccuracyM`), null for an
   *  aligned position a code lined up. Read by the line and the run
   *  alike. */
  function accuracyOf(m: Measurement): number | null {
    return judgedAccuracy(m.rawAccuracyM, m.codeLinedUp);
  }

  /** A station's bands at the position judged by, by the same rule
   *  (`judgedStationBands`, PR #642 review). Read by the prefetch, the
   *  HUD's targets and the breadcrumbs' stop alike. */
  function bandsOf(station: TourStation, m: Measurement): StationBands {
    return judgedStationBands(station, m.rawAccuracyM, m.codeLinedUp);
  }

  /** The one gate (visitor plan §3): what this tick may judge, for the
   *  run's arrival and the present station alike; null when nothing may
   *  be judged - no position, no GPS zero yet (no distance), or a
   *  position too weak to guide by (`tooWeakToGuide`). */
  function judged(m: Measurement): Judgement | null {
    if (m.best === null || m.distances.size === 0) return null;
    const accuracyM = accuracyOf(m);
    if (tooWeakToGuide(accuracyM)) return null;
    return { distances: m.distances, accuracyM };
  }

  /** Whether the guide waits for a heading (D34), in the store; only a
   *  change is dispatched. */
  function publishHeadingPending(pending: boolean): void {
    const store = deps.guideStore;
    if (store === undefined) return;
    if (store.getState().visitorGuide.headingPending !== pending) {
      store.dispatch(headingPendingSet(pending));
    }
  }

  /** What presence may read this tick: the gate's judgement, else a fix
   *  too weak to guide by - which can only end presence (`presenceAfter`,
   *  PR review S1) - else nothing (null: hold). */
  function presenceJudgement(
    m: Measurement,
    j: Judgement | null,
  ): PresenceJudgement | null {
    if (runStations === null) return null;
    const accuracyM = j?.accuracyM ?? accuracyOf(m);
    const weak = j === null && m.best !== null && m.distances.size > 0;
    if (j === null && !(weak && tooWeakToGuide(accuracyM))) return null;
    return {
      candidates: presenceCandidates(runStations, m.distances, (station) =>
        bandsOf(station, m),
      ),
      accuracyM,
      codeLinedUp: m.codeLinedUp,
    };
  }

  /** The store's presence after this tick: a tour change resets it, a
   *  station a code made present ends once the code goes and nothing can
   *  judge, and a judgement is dispatched only when it changes the answer.
   *  Called at the END of a tick: a dispatch re-enters the tick through the
   *  store's subscriber, which then finds nothing to change. */
  function publishPresence(m: Measurement | null, j: Judgement | null): void {
    const store = deps.guideStore;
    if (store === undefined) return;
    if (tourChangePending) {
      tourChangePending = false;
      presentByCode = false;
      const s = store.getState().visitorGuide;
      if (s.presentStationId !== null || s.showAllContent) {
        store.dispatch(guideTourChanged());
      }
    }
    if (m === null) return;
    const state = store.getState().visitorGuide;
    if (j === null && presentByCode && !m.codeLinedUp) {
      presentByCode = false;
      if (state.presentStationId !== null) store.dispatch(presenceCleared());
      return;
    }
    const judgement = presenceJudgement(m, j);
    if (judgement === null) return;
    if (j !== null) presentByCode = m.codeLinedUp;
    if (presenceAfter(state, judgement) !== state.presentStationId) {
      store.dispatch(presenceJudged(judgement));
    }
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
  function approach(m: Measurement): void {
    const { distances } = m;
    if (deps.onApproach === undefined || run === null) return;
    for (const id of run.offered()) {
      const d = distances.get(id);
      const station = stationById(id);
      if (d === undefined || station === undefined) continue;
      deps.onApproach(station, d, bandsOf(station, m).activateM);
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

  /** The HUD's markers: the `HUD_NEAREST_STATIONS` nearest offered
   *  stations not yet found (a station with no distance yet counts as
   *  farthest), in the offer's order. A present station that is offered
   *  is found already, so these are the stations whose content is hidden. */
  function hudTargets(): WayfindingTarget[] {
    if (run === null || last === null || last.headingNue === null) return [];
    const eyeHeight = last.headingNue[1];
    const distances = last.distances;
    const targets: WayfindingTarget[] = [];
    for (const id of run.offered()) {
      const status = run.status(id);
      const station = stationById(id);
      const pose = poseOf(id);
      if (status?.state === "found" || station === undefined || pose === null) {
        continue;
      }
      const bands = bandsOf(station, last);
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
    return nearestOf(targets, HUD_NEAREST_STATIONS, (t) =>
      distances.get(t.id ?? ""),
    );
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
    const d = last?.distances.get(focus);
    const waiting =
      run.offered().length > 1
        ? `${String(run.offered().length)} stations to find - nearest: ${title}`
        : `Next: ${title}`;
    if (last === null) return `${lead}${waiting} - waiting for your position…`;
    // Before the position: a fix too weak to guide by is what the visitor
    // can act on (step into the open), with a position or still without.
    const accuracyM = accuracyOf(last);
    if (accuracyM !== null && tooWeakToGuide(accuracyM)) {
      return `${lead}${waiting} - GPS too weak to guide you (±${distanceText(accuracyM)}); step into the open.`;
    }
    if (last.best === null) {
      return `${lead}${waiting} - waiting for your position…`;
    }
    // Every station has a spot of its own (version 3, D9): no distance
    // yet means no session zero to measure it in yet.
    if (d === undefined) {
      return `${lead}${waiting} - waiting for your position…`;
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
    deps.onGuide?.(last!.headingNue, guideTarget());
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
    // The skip clock starts with the first distance, sized by it (r881
    // review M2: started without one, it suggested the skip after the bare
    // allowance to a visitor still waiting for a position).
    const focusDistance =
      focus === null ? undefined : last?.distances.get(focus);
    if (focus !== null && focusDistance !== undefined) {
      run.focus(focus, deps.now(), focusDistance);
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
      stopM: bandsOf(station, last).foundExitM,
    };
  }

  function ensureHud(): void {
    if (hud !== null || run === null || run.isComplete()) return;
    hud = deps.startHud(hudTargets);
  }

  const guide: StationGuide = {
    tick() {
      const current = currentRun();
      // The scan gate is checked every tick, not only when the run was
      // created (K4 review R8): a later AR session waits behind its own.
      if (current === null || !deps.placementAllowed()) {
        show(dom.line, "");
        show(dom.skip, "");
        deps.onGuide?.(null, null);
        publishPresence(null, null);
        publishHeadingPending(false);
        return;
      }
      measure();
      const m = last!;
      // A story cut short by the session's end plays again on the same
      // terms as its first play: a position and the GPS zero (R8: before
      // them its figure had no pose; r881 re-review M-C: a camera position
      // was required, which a session never ready never has). Its figure
      // waits for the heading as on a first play (`figurePoseOf`).
      if (replayFound && measuredZero !== null && m.best !== null) {
        replayFound = false;
        for (const status of current.statuses()) {
          const station = stationById(status.id);
          if (status.state === "found" && station !== undefined) {
            deps.onFound(station);
          }
        }
      }
      if (m.headingNue !== null) deps.onVisitor?.(m.headingNue);
      approach(m);
      const judgement = judged(m);
      if (judgement !== null) {
        handle(
          current.observe({
            distances: judgement.distances,
            nowMs: deps.now(),
            accuracyM: judgement.accuracyM,
          }),
        );
      }
      render();
      publishPresence(m, judgement);
      // Stations still to point at, and no heading to point with (D34).
      publishHeadingPending(!headingReady && !current.isComplete());
    },
    codeLocked() {
      guide.tick();
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
      // The next AR entry earns its own heading (a new session's odometry).
      trackedHeading = false;
      headingReady = false;
      // Nothing is present outside an AR session (visitor plan §3).
      presentByCode = false;
      if (deps.guideStore?.getState().visitorGuide.presentStationId != null) {
        deps.guideStore.dispatch(presenceCleared());
      }
      publishHeadingPending(false);
      deps.onGuide?.(null, null);
      dom.line.hidden = true;
      dom.skip.hidden = true;
    },
    poseOf,
    figurePoseOf: (stationId) => (headingReady ? poseOf(stationId) : null),
  };
  return guide;
}

/** The raw accuracy that speaks for a position: the median of the latest
 *  fixes, and for a lone fix the worse of that and its own. */
function rawAccuracyFor(
  visitor: VisitorPosition,
  loneFix: boolean,
): number | null {
  return loneFix
    ? worseAccuracy(visitor.accuracyM, visitor.fixAccuracyM)
    : visitor.accuracyM;
}

/** The worse of two accuracies (m); an unknown one gives way to a known. */
function worseAccuracy(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}
