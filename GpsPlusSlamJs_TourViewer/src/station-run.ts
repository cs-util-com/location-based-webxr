/**
 * The visitor's station run (tour kit plan K4, §4.2): each station's state
 * (waiting -> found -> done), which stations the order preset
 * offers, the labelled skip of §8 D5, and when to suggest it. Pure: no
 * clock of its own (every call carries the page time), no DOM, no AR. The
 * wiring (`station-guide.ts`) feeds it distances and the scene player's
 * ends.
 *
 * - Only OFFERED stations change state: under `fixed` order a station later
 *   in the list is not found by walking past it.
 * - FOUND is a latch: a noisy estimate never un-finds a station. Found by
 *   its radius alone (tour editor plan 2026-10-17-1816 D16): the caller's
 *   distance from the phone's current best position is inside the
 *   station's found radius (`station-bands.ts`). The accuracy never widens
 *   it; a position too weak to guide by (`PositionPrecision.tooWeak`, the
 *   framework's one rule) judges nothing,
 *   so the latch agrees with the guide's line (PR #640 review). A code lock
 *   is no arrival (D9: a scan only improves the position), and
 *   there is no "I'm here" (W7, 0348 M2).
 * - DONE when the station's steps finish (`finish`), or skipped (`skip`).
 *   A station with no steps (a newer minor's steps all left out, K1 review
 *   R4) is done the moment it is found.
 * - No deadlock (§8 D5): every order preset offers something until the run
 *   is complete, and the skip is always there for an offered station.
 * - COMPLETE is progress (nothing offered); FINISHED is the visitor's: the
 *   tour finishes once it is complete AND the visitor left the last
 *   station done (`left`, the guide's presence) or tapped "Finish the
 *   tour" (`finish-tour`). A skip that completes it finishes it at once:
 *   a skipped station is never entered. A station brought back unfinishes
 *   it. The completion card and the list's opening wait for FINISHED.
 *
 * The rules are pure transitions over plain data (`WalkProgress`): `applyWalkStep` and the
 * queries below. The page's store applies them in its `visitorWalk`
 * reducer (`visitor-walk-slice.ts`), one rule in the store;
 * `createStationRun` is a thin adapter holding one `WalkProgress` in its
 * closure, and `stationRunOver` the same calls over progress kept
 * elsewhere (the guide's store).
 */

import type {
  TourOrder,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-stations";

import type { PositionPrecision } from "gps-plus-slam-app-framework/state/position-precision";

import { stationBands } from "./station-bands.js";

/** No state between waiting and found (K4 review R10): an "active" state
 *  with its own hysteresis drove nothing a visitor sees. */
type StationState = "waiting" | "found" | "done";

interface StationStatus {
  readonly id: string;
  readonly state: StationState;
  /** Done by the visitor's "skip, I can't get there". */
  readonly skipped: boolean;
  /** When it first became the focus (the skip clock's start, K4 review
   *  R14), on the caller's clock; null until then. */
  readonly focusedAtMs: number | null;
  /** The distance when it became the focus (else the first observed
   *  after): the skip clock's scale. */
  readonly focusDistanceM: number | null;
}

export type StationEvent =
  | { readonly kind: "found"; readonly id: string }
  | { readonly kind: "done"; readonly id: string; readonly skipped: boolean }
  /** The offered set changed; the full new set. */
  | { readonly kind: "offered"; readonly ids: readonly string[] }
  | { readonly kind: "complete" }
  | { readonly kind: "finished" };

/**
 * A station's name - the package's one rule for it (plan 2026-10-15-0348
 * M0), for the visitor's lines and the editor's rail, map and warnings
 * alike: its trimmed title; an untitled (or blank) station is "Station N"
 * by its 1-based `number` in the story where the caller knows it, else
 * "the next station".
 */
export function stationTitle(
  station: Pick<TourStation, "title">,
  number?: number,
): string {
  const title = station.title?.trim() ?? "";
  if (title !== "") return title;
  return number === undefined
    ? "the next station"
    : `Station ${String(number)}`;
}

/**
 * The skip suggestion's fixed allowance: time to read the line, turn
 * around and pick a way (2 minutes; `station-run.sweep.test.ts`).
 */
export const SKIP_SUGGEST_BASE_MS = 120_000;
/**
 * The walking speed the clock grants on top, per straight-line metre at
 * the offer: 0.5 m/s, below a slow stroll (0.8 m/s) with a street detour of
 * 1.5x. A visitor slower than that, or on a longer detour, is shown the
 * suggestion early - it is a suggestion; the skip itself is always there.
 */
export const SKIP_SUGGEST_SLOW_MPS = 0.5;

/** When the skip is suggested, after the station became the focus, for a
 *  straight-line distance then (unknown: the allowance alone). */
export function skipSuggestAfterMs(focusDistanceM: number | null): number {
  const d =
    focusDistanceM !== null && Number.isFinite(focusDistanceM)
      ? Math.max(0, focusDistanceM)
      : 0;
  return SKIP_SUGGEST_BASE_MS + (d / SKIP_SUGGEST_SLOW_MPS) * 1000;
}

export interface StationRun {
  /** The stations offered now, in list order. Empty once complete. */
  offered(): readonly string[];
  status(id: string): StationStatus | undefined;
  statuses(): readonly StationStatus[];
  isComplete(): boolean;
  /** Complete, and the visitor left the last station or tapped "Finish
   *  the tour" (or a skip completed it). */
  isFinished(): boolean;
  /** Complete but not finished: the station the finish waits on (the
   *  last one done); null otherwise. */
  finishWait(): string | null;
  /** The visitor is no longer at this station: finishes the tour when it
   *  is the station the finish waits on. */
  left(id: string): StationEvent[];
  /** "Finish the tour": finishes a complete tour. */
  finishTour(): StationEvent[];
  /**
   * Horizontal distances (m) from the phone's current best position to the
   * stations the caller can place (D16). A station without a finite
   * distance is not judged: with no position, nothing is reached.
   * `precision` is that position's (`position-precision`): too weak to
   * guide by - GPS above the ceiling, where the guide's line says so (PR
   * #640 review), or nothing to judge by - and nothing is judged. A code's
   * position (`'code'`, no number) is judged by the radius alone, whatever
   * the raw fixes' accuracy (M5c review #1). Absent: judged by the radius
   * alone.
   */
  observe(input: {
    readonly distances: ReadonlyMap<string, number>;
    readonly nowMs: number;
    readonly precision?: PositionPrecision;
  }): StationEvent[];
  /** The station's steps finished (a found station only). */
  finish(id: string, nowMs: number): StationEvent[];
  /** "Skip, I can't get there" (an offered station not yet done). */
  skip(id: string, nowMs: number): StationEvent[];
  /** Whether to suggest the skip for this offered, unfound station now:
   *  its clock, started when it became the focus, ran out. */
  skipSuggested(id: string, nowMs: number): boolean;
  /** The station the visitor is pointed at now (the guide's focus): its
   *  skip clock starts at the first call, with the distance then (K4
   *  review R14: under `any` order every clock started at the tour's
   *  start, so after two minutes every focus was a one-tap skip). */
  focus(id: string, nowMs: number, distanceM: number | null): void;
  /** Bring a skipped station back, at any time (R14):
   *  it waits again, unskipped, with a fresh clock, and the order
   *  offers it as before the skip. A station that was not skipped:
   *  nothing. */
  unskip(id: string, nowMs: number): StationEvent[];
  /**
   * Under `fixed` order, while the one offered station is found
   * (its story plays): the station offered once it is done, else null (K4
   * review R5: its media are read while the current story plays). Under
   * `any` order always null - every station not done is offered already.
   */
  upcoming(): string | null;
}

/** One station of a walk: its status, and the fact of the tour the
 *  transitions read, fixed when the walk starts. */
interface WalkStation extends StationStatus {
  /** No steps (a newer minor's steps all left out, K1 review R4) and no
   *  card to read (no description, no card picture): done the moment it is
   *  found. */
  readonly stepless: boolean;
}

/**
 * The visitor's walk through one tour as plain data: the order preset and
 * every station in list order. The offer is derived (`walkOffered`), never
 * stored.
 * Station ids are unique (the tour's parser refuses duplicates).
 */
export interface WalkProgress {
  readonly order: TourOrder;
  readonly stations: readonly WalkStation[];
  /** Complete, and finished by the visitor (`walkFinished`). */
  readonly finished: boolean;
  /** Complete but not finished: the last station done, whose leaving
   *  finishes the tour; null otherwise. */
  readonly finishWaitId: string | null;
}

/** The tour facts a walk starts from: per station, in list order. */
export type WalkRoute = readonly {
  readonly id: string;
  readonly stepless: boolean;
}[];

/**
 * One transition of a walk. Each applies only where its rule allows and
 * changes nothing otherwise (`applyWalkStep`):
 * - `found` - an offered, waiting station (the caller judged its radius);
 * - `focus-distance` - the first distance of a clock started without one;
 * - `finish` - a found station's steps ended;
 * - `skip` - an offered station not yet done;
 * - `unskip` - a skipped station waits again;
 * - `focus` - an offered station's skip clock starts, once;
 * - `left` - the visitor is no longer at a station: finishes a complete
 *   tour waiting on it;
 * - `finish-tour` - "Finish the tour": finishes a complete tour.
 */
export type WalkStep =
  | { readonly kind: "found"; readonly id: string }
  | {
      readonly kind: "focus-distance";
      readonly id: string;
      readonly distanceM: number;
    }
  | { readonly kind: "finish"; readonly id: string }
  | { readonly kind: "skip"; readonly id: string }
  | { readonly kind: "unskip"; readonly id: string }
  | {
      readonly kind: "focus";
      readonly id: string;
      readonly atMs: number;
      readonly distanceM: number | null;
    }
  | { readonly kind: "left"; readonly id: string }
  | { readonly kind: "finish-tour" };

/** A transition's result: the next progress (the same object when nothing
 *  changed) and what happened. */
interface WalkTransition {
  readonly progress: WalkProgress;
  readonly events: StationEvent[];
}

/** A tour that holds no assets. */
const NO_ASSETS: ReadonlySet<string> = new Set();

/**
 * Whether `station` has a card to read without a story: a description, or
 * a card picture the tour holds (`assets`, by asset id). A picture naming
 * an asset the tour does not hold shows nothing, so it is no card. The one
 * rule for the walk (`walkRoute`) and the card (`scene-view.ts`).
 */
export function stationHasCard(
  station: Pick<TourStation, "description" | "image">,
  assets: { has(id: string): boolean },
): boolean {
  return (
    (station.description ?? "") !== "" ||
    (station.image !== undefined && assets.has(station.image))
  );
}

/** The tour facts of these stations, for `startWalk`. A station with no
 *  steps but a card (`stationHasCard`, against the tour's `assets`) is not
 *  stepless: its card stays until Continue (`scene-view.ts`), whose story
 *  end finishes it. No `assets`: the tour holds none. */
export function walkRoute(
  stations: readonly TourStation[],
  assets: { has(id: string): boolean } = NO_ASSETS,
): WalkRoute {
  return stations.map((s) => ({
    id: s.id,
    stepless: s.steps.length === 0 && !stationHasCard(s, assets),
  }));
}

/** A walk at its start: every station waiting. */
export function startWalk(route: WalkRoute, order: TourOrder): WalkProgress {
  return {
    order,
    stations: route.map((r) => ({
      id: r.id,
      stepless: r.stepless,
      state: "waiting",
      skipped: false,
      focusedAtMs: null,
      focusDistanceM: null,
    })),
    finished: false,
    finishWaitId: null,
  };
}

/** Whether the visitor finished the tour (`WalkProgress.finished`). */
export function walkFinished(p: WalkProgress): boolean {
  return p.finished;
}

/** The station a complete tour waits on to finish; null otherwise. */
export function walkFinishWaitId(p: WalkProgress): string | null {
  return p.finishWaitId;
}

/** What the run reads of a progress again and again (several times per
 *  camera frame): derived once per progress. A progress is never changed,
 *  only replaced by a step that changes something, so its identity keys
 *  it; a replaced one is collected with its entry. */
interface Derived {
  readonly byId: ReadonlyMap<string, WalkStation>;
  offered?: readonly string[];
}
const derived = new WeakMap<WalkProgress, Derived>();

function derivedOf(p: WalkProgress): Derived {
  let d = derived.get(p);
  if (d === undefined) {
    d = { byId: new Map(p.stations.map((s) => [s.id, s])) };
    derived.set(p, d);
  }
  return d;
}

function stationOf(p: WalkProgress, id: string): WalkStation | undefined {
  return derivedOf(p).byId.get(id);
}

/** The stations offered now, in list order; empty once complete. */
export function walkOffered(p: WalkProgress): readonly string[] {
  const d = derivedOf(p);
  d.offered ??= offeredOf(p);
  return d.offered;
}

function offeredOf(p: WalkProgress): readonly string[] {
  const undone = p.stations.filter((s) => s.state !== "done").map((s) => s.id);
  switch (p.order) {
    case "any":
      return undone;
    case "fixed":
      return undone.slice(0, 1);
  }
}

function isOffered(p: WalkProgress, id: string): boolean {
  return walkOffered(p).includes(id);
}

/** A station's status (without the tour facts); undefined: not in the tour. */
export function walkStatus(
  p: WalkProgress,
  id: string,
): StationStatus | undefined {
  const s = stationOf(p, id);
  return s === undefined ? undefined : statusOf(s);
}

function statusOf(s: WalkStation): StationStatus {
  return {
    id: s.id,
    state: s.state,
    skipped: s.skipped,
    focusedAtMs: s.focusedAtMs,
    focusDistanceM: s.focusDistanceM,
  };
}

/** Under `fixed` order, while the one offered station is found:
 *  the station offered once it is done, else null; always null under
 *  `any`. */
function walkUpcoming(p: WalkProgress): string | null {
  const offered = walkOffered(p);
  if (p.order === "any" || offered.length !== 1) return null;
  const current = offered[0]!;
  if (stationOf(p, current)?.state !== "found") return null;
  return (
    p.stations.find((s) => s.id !== current && s.state !== "done")?.id ?? null
  );
}

/** Whether to suggest the skip for this offered, unfound station now: its
 *  clock, started when it became the focus, ran out. */
function walkSkipSuggested(
  p: WalkProgress,
  id: string,
  nowMs: number,
): boolean {
  const s = stationOf(p, id);
  if (s === undefined || !isOffered(p, id) || s.focusedAtMs === null) {
    return false;
  }
  if (s.state === "found" || s.state === "done") return false;
  return nowMs - s.focusedAtMs >= skipSuggestAfterMs(s.focusDistanceM);
}

function withStation(
  p: WalkProgress,
  id: string,
  change: Partial<WalkStation>,
): WalkProgress {
  return {
    ...p,
    stations: p.stations.map((s) => (s.id === id ? { ...s, ...change } : s)),
  };
}

/** Done: record it, move the order on, report the new offer. */
function complete(
  p: WalkProgress,
  id: string,
  skipped: boolean,
): WalkTransition {
  let next = withStation(p, id, { state: "done", skipped });
  const events: StationEvent[] = [{ kind: "done", id, skipped }];
  const offered = walkOffered(next);
  events.push({ kind: "offered", ids: [...offered] });
  if (offered.length === 0) {
    events.push({ kind: "complete" });
    if (skipped) {
      // A skipped station is never entered: nothing to leave.
      next = { ...next, finished: true, finishWaitId: null };
      events.push({ kind: "finished" });
    } else {
      next = { ...next, finishWaitId: id };
    }
  }
  return { progress: next, events };
}

/** The tour finished: the completion card's moment. */
function finish(p: WalkProgress): WalkTransition {
  return {
    progress: { ...p, finished: true, finishWaitId: null },
    events: [{ kind: "finished" }],
  };
}

/** One step of the walk, where its rule allows it (`WalkStep`); otherwise
 *  the same progress and no events. */
export function applyWalkStep(p: WalkProgress, step: WalkStep): WalkTransition {
  const unchanged: WalkTransition = { progress: p, events: [] };
  if (step.kind === "finish-tour") {
    return p.finishWaitId === null ? unchanged : finish(p);
  }
  if (step.kind === "left") {
    return p.finishWaitId === step.id ? finish(p) : unchanged;
  }
  const s = stationOf(p, step.id);
  if (s === undefined) return unchanged;
  switch (step.kind) {
    case "found": {
      if (s.state !== "waiting" || !isOffered(p, step.id)) return unchanged;
      const next = withStation(p, step.id, { state: "found" });
      const events: StationEvent[] = [{ kind: "found", id: step.id }];
      if (!s.stepless) return { progress: next, events };
      const done = complete(next, step.id, false);
      return { progress: done.progress, events: [...events, ...done.events] };
    }
    case "focus-distance":
      if (
        s.state !== "waiting" ||
        s.focusedAtMs === null ||
        s.focusDistanceM !== null
      ) {
        return unchanged;
      }
      return {
        progress: withStation(p, step.id, { focusDistanceM: step.distanceM }),
        events: [],
      };
    case "finish":
      return s.state === "found" ? complete(p, step.id, false) : unchanged;
    case "skip":
      return s.state !== "done" && isOffered(p, step.id)
        ? complete(p, step.id, true)
        : unchanged;
    case "unskip": {
      if (s.state !== "done" || !s.skipped) return unchanged;
      // Brought back, the tour is no longer complete, nor finished.
      const next: WalkProgress = {
        ...withStation(p, step.id, {
          state: "waiting",
          skipped: false,
          focusedAtMs: null,
          focusDistanceM: null,
        }),
        finished: false,
        finishWaitId: null,
      };
      return {
        progress: next,
        events: [{ kind: "offered", ids: walkOffered(next) }],
      };
    }
    case "focus":
      if (!isOffered(p, step.id) || s.focusedAtMs !== null) return unchanged;
      return {
        progress: withStation(p, step.id, {
          focusedAtMs: step.atMs,
          ...(step.distanceM !== null && Number.isFinite(step.distanceM)
            ? { focusDistanceM: step.distanceM }
            : {}),
        }),
        events: [],
      };
  }
}

/** Where a run's progress lives: read it, and apply one step to it (the
 *  step's events back). */
interface WalkHolder {
  read(): WalkProgress;
  perform(step: WalkStep): StationEvent[];
}

/**
 * The run's calls over progress held elsewhere (`holder`): the guide's store
 * (`station-guide.ts`), or `createStationRun`'s closure. `stations` are the
 * walk's tour, for the found radius the run judges by (D16).
 */
export function stationRunOver(
  stations: readonly TourStation[],
  holder: WalkHolder,
): StationRun {
  const byId = new Map(stations.map((s) => [s.id, s]));
  return {
    offered: () => walkOffered(holder.read()),
    status: (id) => walkStatus(holder.read(), id),
    statuses: () => holder.read().stations.map(statusOf),
    isComplete: () => walkOffered(holder.read()).length === 0,
    isFinished: () => walkFinished(holder.read()),
    finishWait: () => walkFinishWaitId(holder.read()),
    left: (id) => holder.perform({ kind: "left", id }),
    finishTour: () => holder.perform({ kind: "finish-tour" }),

    observe({ distances, precision }) {
      // No arrival on a position the guide calls too weak to guide by.
      if (precision?.tooWeak === true) return [];
      const events: StationEvent[] = [];
      for (const id of walkOffered(holder.read())) {
        const d = distances.get(id);
        if (d === undefined || !Number.isFinite(d)) continue;
        // An earlier station's find (one without steps) can move the offer.
        if (!isOffered(holder.read(), id)) continue;
        const s = stationOf(holder.read(), id);
        const station = byId.get(id);
        if (s === undefined || s.state !== "waiting" || station === undefined) {
          continue;
        }
        if (s.focusedAtMs !== null && s.focusDistanceM === null) {
          events.push(
            ...holder.perform({ kind: "focus-distance", id, distanceM: d }),
          );
        }
        // The bands' found radius reads no accuracy (D16); null is any value.
        if (d <= stationBands(station, null).foundM) {
          events.push(...holder.perform({ kind: "found", id }));
        }
      }
      return events;
    },

    finish: (id) => holder.perform({ kind: "finish", id }),
    skip: (id) => holder.perform({ kind: "skip", id }),
    upcoming: () => walkUpcoming(holder.read()),
    skipSuggested: (id, nowMs) => walkSkipSuggested(holder.read(), id, nowMs),
    focus(id, nowMs, distanceM) {
      holder.perform({ kind: "focus", id, atMs: nowMs, distanceM });
    },
    unskip: (id) => holder.perform({ kind: "unskip", id }),
  };
}

/** A station run holding its own progress (the run's tests, the sweeps):
 *  a thin adapter over the transitions. */
export function createStationRun(input: {
  readonly stations: readonly TourStation[];
  readonly order: TourOrder;
  readonly nowMs: number;
}): StationRun {
  let progress = startWalk(walkRoute(input.stations), input.order);
  return stationRunOver(input.stations, {
    read: () => progress,
    perform(step) {
      const result = applyWalkStep(progress, step);
      progress = result.progress;
      return result.events;
    },
  });
}
