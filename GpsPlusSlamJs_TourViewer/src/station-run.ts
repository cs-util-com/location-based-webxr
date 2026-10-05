/**
 * The visitor's station run (tour kit plan K4, §4.2): each station's state
 * (waiting -> found -> done), which stations the order preset
 * offers, the labelled skip of §8 D5, and when to suggest it. Pure: no
 * clock of its own (every call carries the page time), no DOM, no AR. The
 * wiring (`station-guide.ts`) feeds it distances, code locks and the scene
 * player's ends.
 *
 * - Only OFFERED stations change state: under `fixed` order a station later
 *   in the list is not found by walking past it, nor by scanning its code.
 * - FOUND is a latch: a noisy estimate never un-finds a station. Found by
 *   GPS inside the effective found radius (`station-bands.ts`), or by a
 *   lock of the station's own code from any distance (the caller drops a
 *   code the moved-code check ignores, D20).
 * - DONE when the station's steps finish (`finish`), or skipped (`skip`).
 *   A station with no steps (a newer minor's steps all left out, K1 review
 *   R4) is done the moment it is found.
 * - No deadlock (§8 D5): every order preset offers something until the run
 *   is complete, and the skip is always there for an offered station.
 */

import type {
  TourOrder,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-stations";

import { ACCURACY_CEILING_M, stationBands } from "./station-bands.js";

/** No state between waiting and found (K4 review R10): an "active" state
 *  with its own hysteresis drove nothing a visitor sees. */
type StationState = "waiting" | "found" | "done";

interface StationStatus {
  readonly id: string;
  readonly state: StationState;
  /** Done by the visitor's "skip, I can't get there". */
  readonly skipped: boolean;
  readonly foundVia: "gps" | "code" | null;
  /** When it first became the focus (the skip clock's start, K4 review
   *  R14), on the caller's clock; null until then. */
  readonly focusedAtMs: number | null;
  /** The distance when it became the focus (else the first observed
   *  after): the skip clock's scale. */
  readonly focusDistanceM: number | null;
}

export type StationEvent =
  | {
      readonly kind: "found";
      readonly id: string;
      readonly via: "gps" | "code";
    }
  | { readonly kind: "done"; readonly id: string; readonly skipped: boolean }
  /** The offered set changed; the full new set. */
  | { readonly kind: "offered"; readonly ids: readonly string[] }
  | { readonly kind: "complete" };

/** A station's name for the visitor. */
export function stationTitle(station: TourStation): string {
  return station.title ?? "the next station";
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

/** A fix good enough to judge a distance by. */
function usableAccuracy(accuracyM: number | null): accuracyM is number {
  return (
    accuracyM !== null &&
    Number.isFinite(accuracyM) &&
    accuracyM > 0 &&
    accuracyM <= ACCURACY_CEILING_M
  );
}

export interface StationRun {
  /** The stations offered now, in list order. Empty once complete. */
  offered(): readonly string[];
  status(id: string): StationStatus | undefined;
  statuses(): readonly StationStatus[];
  isComplete(): boolean;
  /**
   * Horizontal distances (m) to the stations the caller can place, at the
   * measured accuracy. A missing accuracy, or one above the ceiling, judges
   * nothing: such a fix cannot tell 10 m from 40 m.
   */
  observe(input: {
    readonly distances: ReadonlyMap<string, number>;
    readonly accuracyM: number | null;
    readonly nowMs: number;
  }): StationEvent[];
  /** A lock of a printed code (its level id) the viewer trusts; `admit`
   *  (default: all) picks which of the stations it anchors it may find - the
   *  guide holds back one the moved-code check has not had its say on yet
   *  (K4 review R1). */
  codeLocked(
    levelId: string,
    nowMs: number,
    admit?: (stationId: string) => boolean,
  ): StationEvent[];
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
  /** Undo a skip (R14): the skipped station waits again, unskipped, with
   *  a fresh clock, and the order offers it as before the skip. A station
   *  that was not skipped: nothing. */
  unskip(id: string, nowMs: number): StationEvent[];
  /**
   * Under `fixed` or `branch` order, while the one offered station is found
   * (its story plays): the station offered once it is done, else null (K4
   * review R5: its media are read while the current story plays). Under
   * `any` order always null - every station not done is offered already.
   */
  upcoming(): string | null;
}

interface Mutable {
  state: StationState;
  skipped: boolean;
  foundVia: "gps" | "code" | null;
  focusedAtMs: number | null;
  focusDistanceM: number | null;
}

export function createStationRun(input: {
  readonly stations: readonly TourStation[];
  readonly order: TourOrder;
  readonly nowMs: number;
}): StationRun {
  const stations = input.stations;
  const index = new Map(stations.map((s, i) => [s.id, i]));
  const states = new Map<string, Mutable>(
    stations.map((s) => [
      s.id,
      {
        state: "waiting",
        skipped: false,
        foundVia: null,
        focusedAtMs: null,
        focusDistanceM: null,
      },
    ]),
  );
  /** `branch` order's one offered station; null once its path ended. */
  let branchCurrent: string | null = stations[0]?.id ?? null;
  let offeredIds = computeOffered();

  function isDone(id: string): boolean {
    return states.get(id)?.state === "done";
  }

  function computeOffered(): string[] {
    const undone = stations.filter((s) => !isDone(s.id)).map((s) => s.id);
    switch (input.order) {
      case "any":
        return undone;
      case "fixed":
        return undone.slice(0, 1);
      case "branch":
        return branchCurrent === null || isDone(branchCurrent)
          ? []
          : [branchCurrent];
    }
  }

  /** The station after `id` in list order that is not done, if any. */
  function undoneAfter(position: number): string | null {
    for (let i = position + 1; i < stations.length; i += 1) {
      const id = stations[i]!.id;
      if (!isDone(id)) return id;
    }
    return null;
  }

  /** `branch`: the station's default next, else its list successor; a
   *  done target falls through to the first undone station after it. */
  function branchNextAfter(id: string): string | null {
    const station = stations[index.get(id)!]!;
    const target = station.next;
    if (target !== undefined && index.has(target)) {
      return isDone(target) ? undoneAfter(index.get(target)!) : target;
    }
    return undoneAfter(index.get(id)!);
  }

  function snapshot(id: string, s: Mutable): StationStatus {
    return { id, ...s };
  }

  function isOffered(id: string): boolean {
    return offeredIds.includes(id);
  }

  /** Done: record it, move the order on, report the new offer. */
  function complete(id: string, skipped: boolean): StationEvent[] {
    const s = states.get(id)!;
    s.state = "done";
    s.skipped = skipped;
    const events: StationEvent[] = [{ kind: "done", id, skipped }];
    if (input.order === "branch" && branchCurrent === id) {
      branchCurrent = branchNextAfter(id);
    }
    const next = computeOffered();
    offeredIds = next;
    events.push({ kind: "offered", ids: [...next] });
    if (next.length === 0) events.push({ kind: "complete" });
    return events;
  }

  function found(id: string, via: "gps" | "code"): StationEvent[] {
    const s = states.get(id)!;
    s.state = "found";
    s.foundVia = via;
    const events: StationEvent[] = [{ kind: "found", id, via }];
    const station = stations[index.get(id)!]!;
    if (station.steps.length === 0) events.push(...complete(id, false));
    return events;
  }

  /** One offered station at one distance: found inside the found radius. */
  function judge(id: string, d: number, accuracyM: number): StationEvent[] {
    const s = states.get(id)!;
    if (s.state === "found" || s.state === "done") return [];
    if (s.focusedAtMs !== null && s.focusDistanceM === null) {
      s.focusDistanceM = d;
    }
    const { foundM } = stationBands(stations[index.get(id)!]!, accuracyM);
    return d <= foundM ? found(id, "gps") : [];
  }

  return {
    offered: () => [...offeredIds],
    status: (id) => {
      const s = states.get(id);
      return s === undefined ? undefined : snapshot(id, s);
    },
    statuses: () => stations.map((st) => snapshot(st.id, states.get(st.id)!)),
    isComplete: () => offeredIds.length === 0,

    observe({ distances, accuracyM }) {
      if (!usableAccuracy(accuracyM)) return [];
      const events: StationEvent[] = [];
      for (const id of [...offeredIds]) {
        const d = distances.get(id);
        if (d === undefined || !Number.isFinite(d) || !isOffered(id)) continue;
        events.push(...judge(id, d, accuracyM));
      }
      return events;
    },

    codeLocked(levelId, _nowMs, admit) {
      const events: StationEvent[] = [];
      for (const station of stations) {
        if (station.anchor.code !== levelId || !isOffered(station.id)) continue;
        const s = states.get(station.id)!;
        if (s.state === "found" || s.state === "done") continue;
        if (admit !== undefined && !admit(station.id)) continue;
        events.push(...found(station.id, "code"));
      }
      return events;
    },

    finish(id) {
      if (states.get(id)?.state !== "found") return [];
      return complete(id, false);
    },

    skip(id) {
      const s = states.get(id);
      if (s === undefined || s.state === "done" || !isOffered(id)) return [];
      return complete(id, true);
    },

    upcoming() {
      if (input.order === "any" || offeredIds.length !== 1) return null;
      const current = offeredIds[0]!;
      if (states.get(current)?.state !== "found") return null;
      if (input.order === "branch") return branchNextAfter(current);
      return (
        stations.find((s) => s.id !== current && !isDone(s.id))?.id ?? null
      );
    },

    skipSuggested(id, nowMs) {
      const s = states.get(id);
      if (s === undefined || !isOffered(id) || s.focusedAtMs === null) {
        return false;
      }
      if (s.state === "found" || s.state === "done") return false;
      return nowMs - s.focusedAtMs >= skipSuggestAfterMs(s.focusDistanceM);
    },

    focus(id, nowMs, distanceM) {
      const s = states.get(id);
      if (s === undefined || !isOffered(id) || s.focusedAtMs !== null) return;
      s.focusedAtMs = nowMs;
      if (distanceM !== null && Number.isFinite(distanceM)) {
        s.focusDistanceM = distanceM;
      }
    },

    unskip(id) {
      const s = states.get(id);
      if (s === undefined || s.state !== "done" || !s.skipped) return [];
      s.state = "waiting";
      s.skipped = false;
      s.focusedAtMs = null;
      s.focusDistanceM = null;
      // Under branch order the skipped station was the one offered.
      if (input.order === "branch") branchCurrent = id;
      offeredIds = computeOffered();
      return [{ kind: "offered", ids: [...offeredIds] }];
    },
  };
}
