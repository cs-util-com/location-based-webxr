/**
 * The station run held in its closure against the same run with its
 * progress in a store of the walk's slice: random sequences of observe,
 * finish, skip, unskip, focus and waits over generated tours (`next`
 * links with cycles, stations without steps) and the three orders give
 * the same events, statuses, offers, completion, upcoming station and
 * skip suggestion after every call.
 *
 * Why it matters: the guide reads the walk from the store, while the
 * run's own tests and its sweeps drive the closure. Both name the same
 * pure transitions (`applyWalkStep`), so a difference - a step the
 * reducer applies another way, a read the adapter takes from somewhere
 * else, a clock kept on one side only - shows as the first call that
 * differs, in any order the visitor can produce.
 */
import { configureStore } from "@reduxjs/toolkit";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  TourOrder,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-stations";
import type { PositionPrecision } from "gps-plus-slam-app-framework/state/position-precision";

import {
  applyWalkStep,
  createStationRun,
  stationRunOver,
  walkRoute,
  type StationRun,
} from "./station-run";
import {
  visitorWalkReducer,
  walkStarted,
  walkStepped,
} from "./visitor-walk-slice";

type Call =
  | {
      readonly kind: "observe";
      readonly distances: readonly (number | null)[];
      readonly precision: "absent" | "gps" | "weak" | "none" | "code";
    }
  | { readonly kind: "finish"; readonly station: number }
  | { readonly kind: "skip"; readonly station: number }
  | { readonly kind: "unskip"; readonly station: number }
  | {
      readonly kind: "focus";
      readonly station: number;
      readonly distanceM: number | null;
    }
  | { readonly kind: "wait"; readonly ms: number };

const PRECISION: Record<
  Exclude<Extract<Call, { kind: "observe" }>["precision"], "absent">,
  PositionPrecision
> = {
  gps: { source: "gps", accuracyM: 4, tooWeak: false },
  weak: { source: "gps", accuracyM: 40, tooWeak: true },
  none: { source: "none", accuracyM: null, tooWeak: true },
  code: { source: "code", accuracyM: null, tooWeak: false },
};

const callArb = (n: number): fc.Arbitrary<Call> => {
  // Index n is a station id the tour does not have.
  const station = fc.integer({ min: 0, max: n });
  const distance = fc.option(
    fc.oneof(
      fc.double({ min: 0, max: 40, noNaN: true }),
      fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, 5, 10),
    ),
    { nil: null },
  );
  return fc.oneof(
    {
      weight: 5,
      arbitrary: fc.record({
        kind: fc.constant("observe" as const),
        distances: fc.array(distance, { minLength: n, maxLength: n }),
        precision: fc.constantFrom(
          "absent" as const,
          "gps" as const,
          "gps" as const,
          "weak" as const,
          "none" as const,
          "code" as const,
        ),
      }),
    },
    {
      weight: 2,
      arbitrary: fc.record({ kind: fc.constant("finish" as const), station }),
    },
    {
      weight: 2,
      arbitrary: fc.record({ kind: fc.constant("skip" as const), station }),
    },
    {
      weight: 2,
      arbitrary: fc.record({ kind: fc.constant("unskip" as const), station }),
    },
    {
      weight: 2,
      arbitrary: fc.record({
        kind: fc.constant("focus" as const),
        station,
        distanceM: distance,
      }),
    },
    {
      weight: 2,
      arbitrary: fc.record({
        kind: fc.constant("wait" as const),
        ms: fc.constantFrom(1_000, 60_000, 130_000, 400_000),
      }),
    },
  );
};

const caseArb = fc.integer({ min: 1, max: 6 }).chain((n) =>
  fc.record({
    stations: fc.array(
      fc.record({
        next: fc.option(fc.integer({ min: 0, max: n }), { nil: undefined }),
        steps: fc.integer({ min: 0, max: 3 }).map((k) => k > 0),
        foundRadiusM: fc.constantFrom(3, 5, 10),
      }),
      { minLength: n, maxLength: n },
    ),
    order: fc.constantFrom<TourOrder>("fixed", "any", "branch"),
    calls: fc.array(callArb(n), { minLength: 1, maxLength: 80, size: "max" }),
  }),
);

function tourOf(
  specs: readonly {
    next: number | undefined;
    steps: boolean;
    foundRadiusM: number;
  }[],
): TourStation[] {
  return specs.map((s, i) => ({
    id: `s${String(i)}`,
    title: `S${String(i)}`,
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
    items: [],
    activateRadiusM: s.foundRadiusM * 4,
    foundRadiusM: s.foundRadiusM,
    hint: "arrow",
    // A `next` past the last station names one the tour does not have.
    ...(s.next === undefined ? {} : { next: `s${String(s.next)}` }),
    steps: s.steps
      ? [
          {
            id: "t",
            block: { kind: "text", text: "Hi" },
            advance: { mode: "tap" },
          },
        ]
      : [],
  }));
}

/** Everything a caller can read of a run, for every id it may ask of. */
function view(run: StationRun, ids: readonly string[], nowMs: number) {
  return {
    offered: run.offered(),
    statuses: run.statuses(),
    status: ids.map((id) => run.status(id) ?? null),
    complete: run.isComplete(),
    upcoming: run.upcoming(),
    suggested: ids.map((id) => run.skipSuggested(id, nowMs)),
  };
}

/** One call on a run; its events. */
function call(
  run: StationRun,
  c: Call,
  ids: readonly string[],
  nowMs: number,
): unknown {
  switch (c.kind) {
    case "observe": {
      const distances = new Map<string, number>();
      c.distances.forEach((d, i) => {
        if (d !== null) distances.set(ids[i]!, d);
      });
      return run.observe({
        distances,
        nowMs,
        ...(c.precision === "absent"
          ? {}
          : { precision: PRECISION[c.precision] }),
      });
    }
    case "finish":
      return run.finish(ids[c.station]!, nowMs);
    case "skip":
      return run.skip(ids[c.station]!, nowMs);
    case "unskip":
      return run.unskip(ids[c.station]!, nowMs);
    case "focus":
      run.focus(ids[c.station]!, nowMs, c.distanceM);
      return null;
    case "wait":
      return null;
  }
}

/**
 * The run with its progress in a store of the walk's slice: every step
 * goes through the reducer, every read comes from the store, so the slice
 * applies the rules and the adapter only names them.
 */
function runThroughTheSlice(
  stations: readonly TourStation[],
  order: TourOrder,
): StationRun {
  const store = configureStore({
    reducer: { visitorWalk: visitorWalkReducer },
  });
  store.dispatch(walkStarted({ order, route: walkRoute(stations) }));
  const progress = () => {
    const p = store.getState().visitorWalk.progress;
    if (p === null) throw new Error("no walk");
    return p;
  };
  return stationRunOver(stations, {
    read: progress,
    perform(step) {
      const { events } = applyWalkStep(progress(), step);
      store.dispatch(walkStepped(step));
      return events;
    },
  });
}

describe("the station run, held in its closure and through the walk's store", () => {
  it("gives the same events and the same view after every call, in every order", () => {
    /** Each event kind seen, and an unskip that brought a station back. */
    const seen = {
      found: 0,
      done: 0,
      skipped: 0,
      offered: 0,
      complete: 0,
      unskip: 0,
    };
    fc.assert(
      fc.property(caseArb, ({ stations: specs, order, calls: sequence }) => {
        const stations = tourOf(specs);
        // The ids a caller may ask of, one the tour does not have included.
        const ids = [...stations.map((s) => s.id), "nowhere"];
        let nowMs = 5_000_000;
        const closure = createStationRun({ stations, order, nowMs });
        const slice = runThroughTheSlice(stations, order);
        expect(view(slice, ids, nowMs)).toEqual(view(closure, ids, nowMs));
        sequence.forEach((c, k) => {
          if (c.kind === "wait") nowMs += c.ms;
          const want = call(closure, c, ids, nowMs);
          const viaSlice = call(slice, c, ids, nowMs);
          const at = `call ${String(k)} ${JSON.stringify(c)}`;
          expect(viaSlice, at).toEqual(want);
          expect(view(slice, ids, nowMs), at).toEqual(
            view(closure, ids, nowMs),
          );
          if (!Array.isArray(want)) return;
          if (c.kind === "unskip" && want.length > 0) seen.unskip += 1;
          for (const e of want as {
            kind: keyof typeof seen;
            skipped?: boolean;
          }[]) {
            seen[e.kind] += 1;
            if (e.skipped === true) seen.skipped += 1;
          }
        });
      }),
      { numRuns: 500 },
    );
    // Not vacuous: every kind of event and an undone skip were compared.
    for (const [kind, count] of Object.entries(seen)) {
      expect(count, kind).toBeGreaterThan(50);
    }
  }, 120_000);
});
