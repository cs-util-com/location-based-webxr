import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type {
  TourOrder,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-stations";

import {
  createStationRun,
  SKIP_SUGGEST_BASE_MS,
  SKIP_SUGGEST_SLOW_MPS,
  skipSuggestAfterMs,
} from "./station-run";
import { ACCURACY_CEILING_M } from "./station-bands";

/**
 * Why these tests matter: the station run is the tour's whole game state on
 * the visitor's phone. A station found from the wrong side of town, a code
 * that still counts after it was moved, an order that offers a station
 * nobody can reach with no way past it (plan §8 D5), or a station that
 * quietly drops out of the order would each end a castle tour half-way.
 * The examples pin each rule; the properties walk generated tours to the
 * end under every order preset.
 */

const step = {
  id: "s1",
  block: { kind: "text", text: "Hello" },
  advance: { mode: "tap" },
} as const;

function station(id: string, extra: Partial<TourStation> = {}): TourStation {
  return {
    id,
    anchor: { geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 } },
    activateRadiusM: 30,
    foundRadiusM: 5,
    hint: "arrow",
    steps: [step],
    ...extra,
  };
}

const at = (pairs: Record<string, number>) => new Map(Object.entries(pairs));

describe("createStationRun: states", () => {
  it("waits, is found by GPS inside the found radius, and is done when its steps finish", () => {
    const run = createStationRun({
      stations: [station("a")],
      order: "fixed",
      nowMs: 0,
    });
    expect(run.status("a")?.state).toBe("waiting");
    expect(
      run.observe({ distances: at({ a: 100 }), accuracyM: 4, nowMs: 1 }),
    ).toEqual([]);
    expect(
      run.observe({ distances: at({ a: 4 }), accuracyM: 4, nowMs: 3 }),
    ).toEqual([{ kind: "found", id: "a", via: "gps" }]);
    // Found never reverts, however far the noise throws the estimate.
    expect(
      run.observe({ distances: at({ a: 300 }), accuracyM: 4, nowMs: 4 }),
    ).toEqual([]);
    expect(run.status("a")?.state).toBe("found");
    expect(run.finish("a", 5)).toEqual([
      { kind: "done", id: "a", skipped: false },
      { kind: "offered", ids: [] },
      { kind: "complete" },
    ]);
    expect(run.isComplete()).toBe(true);
  });

  it("has no state between waiting and found: walking inside the activation radius changes nothing (K4 review R10)", () => {
    // Why this test matters: the K4 build had an "active" state with its
    // own hysteresis that drove nothing a visitor sees, while the sidecar
    // claimed it showed figures and fetched media. The activation radius
    // now only sets where the prefetch starts (`station-prefetch.ts`).
    const run = createStationRun({
      stations: [station("a")],
      order: "fixed",
      nowMs: 0,
    });
    for (const d of [29, 12, 33, 35, 20]) {
      expect(
        run.observe({ distances: at({ a: d }), accuracyM: 4, nowMs: d }),
      ).toEqual([]);
      expect(run.status("a")?.state).toBe("waiting");
    }
  });

  it("does not judge distances on a fix too poor to place anything (above the accuracy ceiling)", () => {
    const run = createStationRun({
      stations: [station("a")],
      order: "fixed",
      nowMs: 0,
    });
    expect(
      run.observe({
        distances: at({ a: 1 }),
        accuracyM: ACCURACY_CEILING_M + 1,
        nowMs: 1,
      }),
    ).toEqual([]);
    expect(
      run.observe({ distances: at({ a: 1 }), accuracyM: null, nowMs: 1 }),
    ).toEqual([]);
    expect(run.status("a")?.state).toBe("waiting");
  });

  it("is found by its own code's lock from any distance, and only by its own code", () => {
    const run = createStationRun({
      stations: [station("a", { anchor: { code: "level-a" } })],
      order: "fixed",
      nowMs: 0,
    });
    expect(run.codeLocked("level-b", 1)).toEqual([]);
    expect(run.codeLocked("level-a", 2)).toEqual([
      { kind: "found", id: "a", via: "code" },
    ]);
    expect(run.status("a")?.foundVia).toBe("code");
    // A second lock changes nothing.
    expect(run.codeLocked("level-a", 3)).toEqual([]);
  });

  it("a station whose every step was left out (a newer minor) is done the moment it is found", () => {
    const run = createStationRun({
      stations: [station("a", { steps: [] }), station("b")],
      order: "fixed",
      nowMs: 0,
    });
    expect(
      run.observe({ distances: at({ a: 1 }), accuracyM: 4, nowMs: 1 }),
    ).toEqual([
      { kind: "found", id: "a", via: "gps" },
      { kind: "done", id: "a", skipped: false },
      { kind: "offered", ids: ["b"] },
    ]);
  });
});

describe("createStationRun: offering", () => {
  it("fixed: one station at a time, in list order; a station not offered is never found", () => {
    const run = createStationRun({
      stations: [station("a"), station("b", { anchor: { code: "level-b" } })],
      order: "fixed",
      nowMs: 0,
    });
    expect(run.offered()).toEqual(["a"]);
    expect(
      run.observe({ distances: at({ a: 500, b: 1 }), accuracyM: 4, nowMs: 1 }),
    ).toEqual([]);
    expect(run.codeLocked("level-b", 2)).toEqual([]);
    expect(run.status("b")?.state).toBe("waiting");
  });

  it("any: every station not done is offered at once", () => {
    const run = createStationRun({
      stations: [station("a"), station("b"), station("c")],
      order: "any",
      nowMs: 0,
    });
    expect(run.offered()).toEqual(["a", "b", "c"]);
    run.observe({ distances: at({ b: 1 }), accuracyM: 4, nowMs: 1 });
    run.finish("b", 2);
    expect(run.offered()).toEqual(["a", "c"]);
  });

  it("branch: follows each station's default next, else the list order; a done target falls through", () => {
    const run = createStationRun({
      stations: [
        station("a", { next: "c" }),
        station("b"),
        station("c", { next: "a" }),
        station("d"),
      ],
      order: "branch",
      nowMs: 0,
    });
    expect(run.offered()).toEqual(["a"]);
    run.skip("a", 1);
    expect(run.offered()).toEqual(["c"]);
    // c points back at a, which is done: the first undone after it in
    // list order is b.
    run.skip("c", 2);
    expect(run.offered()).toEqual(["b"]);
    run.skip("b", 3);
    expect(run.offered()).toEqual(["d"]);
    run.skip("d", 4);
    expect(run.isComplete()).toBe(true);
  });

  it("names the station that comes next while the current one's story plays (fixed and branch; R5)", () => {
    // Why this test matters (K4 review R5): under a fixed order the next
    // station is offered only once the current is done, so a prefetch keyed
    // on the offer started it with the visitor already on the way; the run
    // names it as soon as the current station is found.
    const fixed = createStationRun({
      stations: [station("a"), station("b"), station("c")],
      order: "fixed",
      nowMs: 0,
    });
    expect(fixed.upcoming()).toBeNull();
    fixed.codeLocked("x", 1);
    fixed.observe({ distances: at({ a: 1 }), accuracyM: 4, nowMs: 1 });
    expect(fixed.upcoming()).toBe("b");
    fixed.finish("a", 2);
    expect(fixed.upcoming()).toBeNull();
    const branch = createStationRun({
      stations: [station("a", { next: "c" }), station("b"), station("c")],
      order: "branch",
      nowMs: 0,
    });
    branch.observe({ distances: at({ a: 1 }), accuracyM: 4, nowMs: 1 });
    expect(branch.upcoming()).toBe("c");
    // Under "any" every station not done is offered already.
    const any = createStationRun({
      stations: [station("a"), station("b")],
      order: "any",
      nowMs: 0,
    });
    any.observe({ distances: at({ a: 1 }), accuracyM: 4, nowMs: 1 });
    expect(any.upcoming()).toBeNull();
  });

  it("skip: a labelled way past a station nobody can reach, recorded as skipped (plan §8 D5)", () => {
    const run = createStationRun({
      stations: [station("a"), station("b")],
      order: "fixed",
      nowMs: 0,
    });
    expect(run.skip("b", 1)).toEqual([]); // not offered: nothing to skip
    expect(run.skip("a", 2)).toEqual([
      { kind: "done", id: "a", skipped: true },
      { kind: "offered", ids: ["b"] },
    ]);
    expect(run.status("a")).toMatchObject({ state: "done", skipped: true });
    expect(run.skip("a", 3)).toEqual([]);
  });
});

describe("skip suggestion clock", () => {
  it("under any order, starts only when a station becomes the focus, at its distance then (R14)", () => {
    // Why this test matters (K4 review R14): every station's clock started
    // at the tour's start, so after about two minutes every focus became a
    // one-tap skip.
    const run = createStationRun({
      stations: [station("a"), station("b")],
      order: "any",
      nowMs: 0,
    });
    run.observe({ distances: at({ a: 30, b: 40 }), accuracyM: 4, nowMs: 0 });
    expect(run.skipSuggested("b", 10_000_000)).toBe(false);
    run.focus("b", 10_000_000, 40);
    // Focusing again later does not restart it.
    run.focus("b", 10_050_000, 5);
    expect(
      run.skipSuggested("b", 10_000_000 + skipSuggestAfterMs(40) - 1),
    ).toBe(false);
    expect(run.skipSuggested("b", 10_000_000 + skipSuggestAfterMs(40))).toBe(
      true,
    );
  });

  it("a skip can be undone: the station is offered again, unskipped, with a fresh clock (R14)", () => {
    for (const order of ["fixed", "any", "branch"] as const) {
      const run = createStationRun({
        stations: [station("a", { next: "b" }), station("b"), station("c")],
        order,
        nowMs: 0,
      });
      run.focus("a", 0, 10);
      run.skip("a", 1);
      expect(run.offered()).not.toContain("a");
      expect(run.unskip("a", 2)).toEqual([
        { kind: "offered", ids: order === "any" ? ["a", "b", "c"] : ["a"] },
      ]);
      expect(run.status("a")).toMatchObject({
        state: "waiting",
        skipped: false,
      });
      expect(run.skipSuggested("a", 10_000_000)).toBe(false);
      // Only a skipped station comes back.
      expect(run.unskip("b", 3)).toEqual([]);
    }
  });

  it("scales with the distance at the offer: a slow walker's time plus a fixed allowance", () => {
    expect(skipSuggestAfterMs(null)).toBe(SKIP_SUGGEST_BASE_MS);
    expect(skipSuggestAfterMs(100)).toBe(
      SKIP_SUGGEST_BASE_MS + (100 / SKIP_SUGGEST_SLOW_MPS) * 1000,
    );
  });

  it("is suggested only for an offered station not yet found, once its clock ran out", () => {
    const run = createStationRun({
      stations: [station("a"), station("b")],
      order: "fixed",
      nowMs: 0,
    });
    run.focus("a", 0, null);
    run.observe({ distances: at({ a: 100 }), accuracyM: 4, nowMs: 0 });
    const due = skipSuggestAfterMs(100);
    expect(run.skipSuggested("a", due - 1)).toBe(false);
    expect(run.skipSuggested("a", due)).toBe(true);
    expect(run.skipSuggested("b", due * 10)).toBe(false); // never offered yet
    run.observe({ distances: at({ a: 1 }), accuracyM: 4, nowMs: due + 1 });
    expect(run.skipSuggested("a", due * 10)).toBe(false); // found
  });

  it("restarts for the next station at the moment it becomes the focus", () => {
    const run = createStationRun({
      stations: [station("a"), station("b")],
      order: "fixed",
      nowMs: 0,
    });
    run.skip("a", 1_000_000);
    run.focus("b", 1_000_000, 40);
    expect(run.skipSuggested("b", 1_000_000 + skipSuggestAfterMs(40) - 1)).toBe(
      false,
    );
    expect(run.skipSuggested("b", 1_000_000 + skipSuggestAfterMs(40))).toBe(
      true,
    );
  });
});

const ORDERS: readonly TourOrder[] = ["fixed", "any", "branch"];

/** Generated tours: 1-8 stations with random default-next links (cycles included). */
const tourArb = fc.integer({ min: 1, max: 8 }).chain((n) =>
  fc.tuple(
    fc.constant(n),
    fc.array(
      fc.option(fc.integer({ min: 0, max: n - 1 }), { nil: undefined }),
      {
        minLength: n,
        maxLength: n,
      },
    ),
    fc.constantFrom(...ORDERS),
    fc.array(fc.tuple(fc.nat(), fc.constantFrom("skip", "find")), {
      maxLength: 40,
    }),
  ),
);

describe("createStationRun: properties", () => {
  it("never deadlocks: always offering something until complete, and completing within one action per station", () => {
    fc.assert(
      fc.property(tourArb, ([n, nexts, order, actions]) => {
        const stations = nexts.map((next, i) =>
          station(`s${i}`, next === undefined ? {} : { next: `s${next}` }),
        );
        const run = createStationRun({ stations, order, nowMs: 0 });
        let t = 1;
        let completions = 0;
        // Arbitrary actions on offered stations first, then drain.
        const act = (pick: number, how: string) => {
          const offered = run.offered();
          if (offered.length === 0) return;
          const id = offered[pick % offered.length]!;
          if (how === "skip") run.skip(id, t++);
          else {
            run.observe({
              distances: new Map([[id, 0]]),
              accuracyM: 4,
              nowMs: t++,
            });
            run.finish(id, t++);
          }
          completions += 1;
        };
        for (const [pick, how] of actions) act(pick, how);
        for (let guard = 0; guard < n + 1 && !run.isComplete(); guard += 1)
          act(0, "skip");
        expect(run.isComplete()).toBe(true);
        expect(completions).toBeLessThanOrEqual(n);
        expect(run.offered()).toEqual([]);
        // fixed and any visit every station; branch may leave stations off
        // its path, but never one that is still offered.
        const undone = run.statuses().filter((s) => s.state !== "done");
        expect(order === "branch" || undone.length === 0).toBe(true);
      }),
    );
  });

  it("never offers a done station, and a done station never changes again", () => {
    fc.assert(
      fc.property(tourArb, ([, nexts, order, actions]) => {
        const stations = nexts.map((next, i) =>
          station(`s${i}`, next === undefined ? {} : { next: `s${next}` }),
        );
        const run = createStationRun({ stations, order, nowMs: 0 });
        let t = 1;
        for (const [pick, how] of actions) {
          const offered = run.offered();
          for (const id of offered)
            expect(run.status(id)?.state).not.toBe("done");
          if (offered.length === 0) break;
          const id = offered[pick % offered.length]!;
          if (how === "skip") run.skip(id, t++);
          else run.finish(id, t++);
          const before = run.status(id);
          if (before?.state !== "done") continue;
          run.observe({
            distances: new Map([[id, 0]]),
            accuracyM: 4,
            nowMs: t++,
          });
          run.skip(id, t++);
          run.codeLocked("level", t++);
          expect(run.status(id)).toEqual(before);
        }
      }),
    );
  });
});
