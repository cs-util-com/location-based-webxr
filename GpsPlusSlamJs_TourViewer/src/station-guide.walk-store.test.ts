/**
 * The station guide on the page's store (visitor walk W4 build plan
 * GpsPlusSlamJs_Docs/docs/2026-10-21-1105-visitor-walk-w4-build-plan.md,
 * M1, §2.2 and §4 "Store churn" / "Re-entry through the store"): the walk
 * lives in `visitorWalk`, the guide dispatches only events, never a frame,
 * and one call's changes arrive as one batch at the call's very end - after
 * its reads and its own other dispatches - so the page's subscriber, which
 * ticks the guide on every dispatch, never meets half a tick.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  TourOrder,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-stations";
import { calcGpsCoords } from "gps-plus-slam-app-framework/core";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import type { PrecisionGpsPoint } from "gps-plus-slam-app-framework/state/position-precision";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import { wireStationGuide, type StationGuideDeps } from "./station-guide";
import { walkOffered, walkStatus } from "./station-run";
import {
  createTourViewerStore,
  type TourViewerStore,
} from "./tour-viewer-session";
import type { VisitorPosition } from "./visitor-position";
import { targetChosen, walkCleared } from "./visitor-walk-slice";
import {
  LogLevel,
  subscribeToLogs,
  type LogEntry,
} from "gps-plus-slam-app-framework/utils/logger";

// The core's geodesy needs an activated store (the framework's factory).
createSlamAppStore({ storageBackend: new NullStorageBackend() });

const zero = { lat: 47.5, lon: 8.7 };

function fixesAt(accuracyM: number): PrecisionGpsPoint[] {
  return [{ latLongAccuracy: accuracyM }];
}

function station(
  id: string,
  north: number,
  east: number,
  extra: Partial<TourStation> = {},
): TourStation {
  const geo = calcGpsCoords(zero, [north, 0, east]);
  return {
    id,
    title: id.toUpperCase(),
    geo: { lat: geo.lat, lon: geo.lon, alt: 400, headingDeg: 0 },
    items: [],
    activateRadiusM: 20,
    foundRadiusM: 5,
    hint: "arrow",
    steps: [
      {
        id: "t",
        block: { kind: "text", text: "Hi" },
        advance: { mode: "tap" },
      },
    ],
    ...extra,
  };
}

function at(
  north: number,
  east: number,
  nowMs: number,
  accuracyM = 4,
): VisitorPosition {
  return {
    nue: [north, 401.5, east],
    gpsPoints: fixesAt(accuracyM),
    fixNue: [north, 400, east],
    aligned: true,
    fixAtMs: nowMs,
    fixAccuracyM: accuracyM,
  };
}

/** The guide on the page's store, with every dispatch logged in order
 *  (and the guide's line at the moment of each walk batch). */
function onThePage(
  stations: readonly TourStation[],
  order: TourOrder,
  options: {
    reenter?: boolean;
    endStory?: boolean;
    /** Another writer, called back from the guide mid-call. */
    onFound?: (id: string) => void;
    onVisitor?: () => void;
  } = {},
) {
  const store = createTourViewerStore();
  let now = 1_000_000;
  let visitor = at(500, 500, now);
  const dispatched: string[] = [];
  /** Per walk batch: what the guide's line and the store's walk said. */
  const atBatch: { line: string; foundInStore: string[] }[] = [];
  const dom = {
    line: { textContent: "", hidden: true },
    skip: { textContent: "", hidden: true, dataset: {} as DOMStringMap },
  };
  const logging = {
    getState: () => store.getState(),
    dispatch: (action: { type: string }) => {
      dispatched.push(action.type);
      const result = store.dispatch(action);
      if (action.type === "visitorWalk/walkBatched") {
        const progress = store.getState().visitorWalk.progress;
        atBatch.push({
          line: dom.line.textContent,
          foundInStore: stations
            .map((s) => s.id)
            .filter((id) =>
              progress === null
                ? false
                : walkStatus(progress, id)?.state === "found",
            ),
        });
      }
      return result;
    },
  } satisfies StationGuideDeps["walkStore"] & StationGuideDeps["guideStore"];
  const found: string[] = [];
  const guide = wireStationGuide({
    dom,
    tour: () => ({ stations, order }),
    placementAllowed: () => true,
    zero: () => zero,
    visitor: () => visitor,
    codeLinedUp: () => false,
    alignmentReady: () => true,
    trackingReady: () => true,
    startHud: () => ({ dispose: () => undefined }),
    now: () => now,
    guideStore: logging,
    walkStore: logging,
    onFound: (s) => {
      found.push(s.id);
      options.onFound?.(s.id);
    },
    onVisitor: () => options.onVisitor?.(),
    ...(options.endStory === true
      ? {
          onEndStory: (id: string) => {
            guide.storyEnded(id);
          },
        }
      : {}),
  });
  if (options.reenter === true) store.subscribe(() => guide.tick());
  return {
    store,
    guide,
    dom,
    found,
    dispatched,
    atBatch,
    move(north: number, east: number, dtMs = 1_000, accuracyM = 4) {
      now += dtMs;
      visitor = at(north, east, now, accuracyM);
    },
  };
}

/** Which steady states a page is in, counted into `steady`. */
function countSteady(
  page: ReturnType<typeof onThePage>,
  steady: Record<
    "armed" | "noteRunOut" | "weakGps" | "story" | "complete",
    number
  >,
): void {
  const state = page.store.getState().visitorWalk;
  const line = page.dom.line.textContent;
  const complete = line.startsWith("Tour complete");
  const noteShown =
    line.startsWith("Skipped ") || line.startsWith("Brought back ");
  if (state.quickArmedId !== null || state.rowArmedId !== null) {
    steady.armed += 1;
  }
  if (state.note !== null && !complete && !noteShown) steady.noteRunOut += 1;
  if (line.includes("GPS too weak")) steady.weakGps += 1;
  if (line.includes("its story is playing")) steady.story += 1;
  if (complete) steady.complete += 1;
}

const walkActions = (types: readonly string[]) =>
  types.filter((t) => t.startsWith("visitorWalk/"));

describe("the station guide on the page's store (W4 M1)", () => {
  // Why: the guide ticks on every camera frame; a dispatch per frame would
  // wake every subscriber, the guide's own tick included (plan §4).
  it("dispatches nothing to the walk while nothing happens, over any number of frames", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.double({ min: -3, max: 3, noNaN: true }),
            fc.double({ min: -3, max: 3, noNaN: true }),
            fc.integer({ min: 0, max: 2_000 }),
          ),
          { minLength: 1, maxLength: 200 },
        ),
        fc.constantFrom<TourOrder>("any", "fixed", "branch"),
        (frames, order) => {
          const page = onThePage(
            [station("a", 60, 0), station("b", -120, 0)],
            order,
          );
          // The first tick starts the walk and the focus's skip clock.
          page.move(0, 0);
          page.guide.tick();
          page.dispatched.length = 0;
          // Jittering in place, far from both stations and always nearest
          // to a (the focus stays), well inside the skip suggestion's two
          // minutes: no event at all.
          for (const [dn, de, dt] of frames) {
            page.move(dn, de, dt);
            page.guide.tick();
          }
          expect(walkActions(page.dispatched)).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Why: the page's subscriber re-enters the guide on every dispatch; a
  // walk change dispatched mid-tick would let it read half a tick.
  it("dispatches one call's changes as one batch, last, with the line already written from them", () => {
    const page = onThePage([station("a", 0, 0), station("b", 30, 0)], "any", {
      reenter: true,
    });
    page.move(10, 0);
    page.guide.tick();
    page.dispatched.length = 0;
    page.atBatch.length = 0;
    // Walk into a's found radius: a find, a presence change, a new focus.
    page.move(1, 0);
    page.guide.tick();
    expect(page.found).toEqual(["a"]);
    const walk = walkActions(page.dispatched);
    // The re-entered ticks found nothing more to change.
    expect(walk).toEqual(["visitorWalk/walkBatched"]);
    expect(page.dispatched.at(-1)).toBe("visitorWalk/walkBatched");
    expect(page.dispatched).toContain("visitorGuide/presenceJudged");
    // When the batch lands the line already shows the tick's walk.
    expect(page.atBatch).toEqual([
      { line: "2 stations to find - nearest: B, 29 m", foundInStore: ["a"] },
    ]);
    expect(page.dom.line.textContent).toBe(page.atBatch[0]!.line);
  });

  // Why (W4 M1 review): the guide's walk is the store's as it is now with
  // the call's pending changes over it - so a change another writer makes
  // mid-call is in it at once, and what one call shows is what the store
  // holds after it, never a copy taken before that change.
  it("reads a change another writer makes mid-call at once: the call shows what the store holds after it", () => {
    const other: { store?: TourViewerStore } = {};
    const page = onThePage(
      [station("a", 0, 0), station("b", 30, 0), station("c", 60, 0)],
      "any",
      {
        // Another writer chooses c as the target when a is found (M4: a
        // row arm would go with the story the find starts).
        onFound: (id) => {
          if (id === "a") other.store?.dispatch(targetChosen("c"));
        },
      },
    );
    other.store = page.store;
    page.move(10, 0);
    page.guide.tick();
    // Into a's found radius: a is found, and c is in focus by the choice.
    page.move(1, 0);
    page.guide.tick();
    expect(page.store.getState().visitorWalk.chosenId).toBe("c");
    expect(page.dom.line.textContent).toBe(
      "3 stations to find - your choice: C, 59 m",
    );
  });

  // Why (W4 M1 review): a walk reset behind the guide's back is no run. A
  // walk started again for the same tour would drop every station the
  // visitor found or skipped, silently; nothing resets it today.
  it("starts no walk again when another writer resets it between calls: no run, nothing shown", () => {
    const page = onThePage([station("a", 0, 0), station("b", 30, 0)], "any");
    page.move(10, 0);
    page.guide.tick();
    page.move(1, 0);
    page.guide.tick();
    expect(page.found).toEqual(["a"]);
    page.store.dispatch(walkCleared());
    page.dispatched.length = 0;
    page.move(1, 0);
    page.guide.tick();
    expect(walkActions(page.dispatched)).toEqual([]);
    expect(page.store.getState().visitorWalk.progress).toBeNull();
    expect(page.dom.line.textContent).toBe("");
    expect(page.dom.skip.textContent).toBe("");
  });

  // Why (W4 M1 review): with no walk there is nothing offered, and an empty
  // offer reads as "Tour complete". A walk another writer resets mid-call
  // must read as no run, never as a tour the visitor finished.
  it("writes no false 'Tour complete' when another writer resets the walk mid-call", () => {
    const other: {
      store?: TourViewerStore;
      reset: boolean;
    } = { reset: false };
    const page = onThePage([station("a", 0, 0), station("b", 30, 0)], "any", {
      onVisitor: () => {
        if (!other.reset) return;
        other.reset = false;
        other.store?.dispatch(walkCleared());
      },
    });
    other.store = page.store;
    page.move(10, 0);
    page.guide.tick();
    expect(page.dom.line.textContent).toMatch(/^2 stations to find/);
    other.reset = true;
    page.move(10, 0);
    page.guide.tick();
    expect(page.dom.line.textContent).toBe("");
    expect(page.dom.skip.textContent).toBe("");
  });

  // Why (CI review): the guide runs on the camera frame, so a run read
  // that finds no walk (a reset between the check and the read, which no
  // writer does today) must never throw out of the frame loop and stop it
  // for the session. It is logged once and the call reads as no run.
  it("reads a walk gone between the guide's check and its read as no run: no throw, one logged error", () => {
    const errors: LogEntry[] = [];
    const unsubscribe = subscribeToLogs((entry) => {
      if (entry.level === LogLevel.ERROR && entry.tag === "StationGuide") {
        errors.push(entry);
      }
    });
    try {
      const page = onThePage([station("a", 0, 0), station("b", 30, 0)], "any");
      page.move(10, 0);
      page.guide.tick();
      expect(page.dom.line.textContent).toMatch(/^2 stations to find/);
      // From now on every second read of the store finds the walk gone:
      // the guide's check sees it, the run's read right after does not.
      const real = page.store.getState.bind(page.store);
      let reads = 0;
      page.store.getState = () => {
        const state = real();
        reads += 1;
        return reads % 2 === 0
          ? { ...state, visitorWalk: { ...state.visitorWalk, progress: null } }
          : state;
      };
      for (let i = 0; i < 3; i += 1) {
        page.move(10, 0);
        expect(() => {
          page.guide.tick();
        }).not.toThrow();
      }
      expect(errors).toHaveLength(1);
    } finally {
      unsubscribe();
    }
  });

  // Why (plan §3 M1): every guide call - a tick, a tap, a story's end -
  // sends at most one walk dispatch, a batch, and sends it after every
  // other dispatch of that call. And a walk that has settled stays quiet:
  // a second tick on the same inputs dispatches nothing to the walk in any
  // steady state (the skip asked, a note run out, GPS too weak, a story
  // playing, the tour complete), each of which the walks reach.
  it("sends at most one walk batch per call, after the call's other dispatches, and none on a repeated tick, whatever the visitor does", () => {
    const callArb = fc.oneof(
      fc.record({
        kind: fc.constant("move" as const),
        near: fc.integer({ min: -1, max: 2 }),
        dtMs: fc.constantFrom(0, 1_000, 7_000, 130_000),
        accuracyM: fc.constantFrom(4, 4, 4, 40),
      }),
      fc.constant({ kind: "skip" as const }),
      fc.record({
        kind: fc.constant("story-end" as const),
        station: fc.integer({ min: 0, max: 2 }),
      }),
    );
    const steady = {
      armed: 0,
      noteRunOut: 0,
      weakGps: 0,
      story: 0,
      complete: 0,
    };
    fc.assert(
      fc.property(
        fc.constantFrom<TourOrder>("any", "fixed", "branch"),
        fc.array(callArb, { minLength: 1, maxLength: 60 }),
        (order, calls) => {
          const spots = [
            [0, 0],
            [25, 0],
            [0, 25],
          ] as const;
          const stations = spots.map(([n, e], i) =>
            station(`s${String(i)}`, n, e, i === 2 ? { steps: [] } : {}),
          );
          const page = onThePage(stations, order, { endStory: true });
          for (const call of calls) {
            page.dispatched.length = 0;
            if (call.kind === "move") {
              const [n, e] = spots[call.near] ?? [300, 300];
              page.move(n + 1, e, call.dtMs, call.accuracyM);
              page.guide.tick();
            } else if (call.kind === "skip") {
              page.guide.skipTapped();
            } else {
              page.guide.storyEnded(`s${String(call.station)}`);
            }
            const walk = walkActions(page.dispatched);
            expect([[], ["visitorWalk/walkBatched"]]).toContainEqual(walk);
            expect(
              walk.length === 0 ||
                page.dispatched.at(-1) === "visitorWalk/walkBatched",
            ).toBe(true);
            // The page's next frame (a tap is not one), then a second on
            // the same inputs: the walk has settled.
            if (call.kind !== "move") page.guide.tick();
            page.dispatched.length = 0;
            page.guide.tick();
            expect(walkActions(page.dispatched)).toEqual([]);
            countSteady(page, steady);
          }
        },
      ),
      { numRuns: 200 },
    );
    // Not vacuous: every steady state was reached and ticked twice.
    for (const [state, count] of Object.entries(steady)) {
      expect(count, state).toBeGreaterThan(0);
    }
  });

  // Why (K4 review R9, re-stated through the store): the existing property
  // that no order can deadlock - stories that never end, stations nobody
  // reaches, only the one skip button tapped - holds with the walk in the
  // page's store and the page's subscription re-entering the guide.
  it("never deadlocks through the page's store: every order completes within two skip taps per station", () => {
    const tourArb = fc
      .integer({ min: 1, max: 5 })
      .chain((n) =>
        fc.tuple(
          fc.constant(n),
          fc.array(
            fc.tuple(
              fc.integer({ min: -150, max: 150 }),
              fc.integer({ min: -150, max: 150 }),
              fc.option(fc.integer({ min: 0, max: n - 1 }), { nil: undefined }),
            ),
            { minLength: n, maxLength: n },
          ),
          fc.constantFrom<TourOrder>("fixed", "any", "branch"),
          fc.array(
            fc.tuple(
              fc.integer({ min: -150, max: 150 }),
              fc.integer({ min: -150, max: 150 }),
              fc.boolean(),
            ),
            { maxLength: 20 },
          ),
        ),
      );
    fc.assert(
      fc.property(tourArb, ([n, specs, order, wander]) => {
        const stations = specs.map(([north, east, next], i) =>
          station(`s${String(i)}`, north, east, {
            ...(next === undefined ? {} : { next: `s${String(next)}` }),
            // One choice whose only option loops back to itself: it never
            // ends on its own.
            steps: [
              {
                id: "ask",
                block: {
                  kind: "choice",
                  prompt: "Again?",
                  options: [{ id: "yes", label: "Yes", goto: "ask" }],
                },
                advance: { mode: "tap" },
              },
            ],
          }),
        );
        const page = onThePage(stations, order, {
          reenter: true,
          endStory: true,
        });
        for (const [north, east, tap] of wander) {
          page.move(north, east);
          page.guide.tick();
          if (tap) page.guide.skipTapped();
        }
        // From here on the visitor stands far from everything and only taps.
        for (let taps = 0; taps < 2 * n + 2; taps += 1) {
          page.move(1000, 1000, 10_000);
          page.guide.tick();
          if (page.dom.line.textContent.startsWith("Tour complete")) break;
          page.guide.skipTapped();
        }
        page.guide.tick();
        expect(page.dom.line.textContent).toMatch(/^Tour complete/);
        // The store says so too: nothing is offered any more.
        const progress = page.store.getState().visitorWalk.progress;
        expect(progress === null ? null : walkOffered(progress)).toEqual([]);
      }),
      { numRuns: 300 },
    );
  }, 120_000);
});
