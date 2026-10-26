import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  TourOrder,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-stations";
import { calcGpsCoords } from "gps-plus-slam-app-framework/core";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import {
  SKIP_UNDO_MS,
  wireStationGuide,
  type WalkRowTap,
} from "./station-guide";
import { walkOffered, walkStatus } from "./station-run";
import { createTourViewerStore } from "./tour-viewer-session";
import type { VisitorPosition } from "./visitor-position";
import { WALK_NO_GUESS_HOLD_MS } from "./walk-no-guess";

/**
 * Why these properties matter: the walk's rules are many small decisions
 * that meet in one state - a skip, a bring back at any time, a chosen
 * target, a story to end, the position degrading and coming back. A unit
 * test pins each edge; these pin what must hold over ANY mix of them:
 * the walk never deadlocks, it is complete exactly when nothing is
 * offered, a found station never becomes unfound, at most one target is
 * chosen and only a waiting offered one, an any-order tour names no
 * station while the no-guess rule holds (its condition derived here, from the
 * harness's own clock), and every tour completes within two taps per
 * station through the story card and the three tap paths of the no-guess rule,
 * and finishes with one tap more ("Finish the tour") unless a skip completed it.
 */

createSlamAppStore({ storageBackend: new NullStorageBackend() });

const zero = { lat: 47.5, lon: 8.7 };
const FAR: [number, number] = [1000, 1000];

/** A story that never ends by itself: one choice looping to itself. */
function station(i: number, north: number, east: number): TourStation {
  const geo = calcGpsCoords(zero, [north, 0, east]);
  return {
    id: `s${String(i)}`,
    title: `S${String(i)}`,
    geo: { lat: geo.lat, lon: geo.lon, alt: 400, headingDeg: 0 },
    activateRadiusM: 20,
    foundRadiusM: 5,
    hint: "arrow",
    items: [],
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
  };
}

/** A fix within the ceiling, a weak one, none, or a lined-up code that
 *  holds the position (no device fix at all). */
type Precision = "gps" | "weak" | "none" | "code";

function harness(stations: TourStation[], order: TourOrder) {
  let now = 1_000;
  let spot = FAR;
  let precision: Precision = "gps";
  const playing: string[] = [];
  let visitor: VisitorPosition = {
    nue: null,
    gpsPoints: [],
    fixNue: null,
    aligned: true,
    fixAtMs: null,
    fixAccuracyM: null,
  };
  // The no-guess clock, kept here from the harness's own inputs and not
  // from the guide or the slice: no distance is shown without GPS within
  // the ceiling or a lined-up code; a guess comes back once a GPS distance
  // has been back, unbroken, for the hold, and at once when the distance
  // is a code's.
  const r2 = { noDistance: false, backAtMs: null as number | null };
  const store = createTourViewerStore();
  const dom = {
    line: { textContent: "", hidden: true },
    skip: { textContent: "", hidden: true, dataset: {} as DOMStringMap },
    end: { textContent: "", hidden: true, dataset: {} as DOMStringMap },
  };
  const guide = wireStationGuide({
    dom,
    tour: () => ({ stations, order }),
    placementAllowed: () => true,
    zero: () => zero,
    visitor: () => visitor,
    codeLinedUp: () => precision === "code",
    alignmentReady: () => true,
    trackingReady: () => true,
    startHud: () => ({ dispose: () => undefined }),
    now: () => now,
    walkStore: store,
    storyPlaying: () => playing[0] ?? null,
    onFound: (s) => {
      playing.push(s.id);
    },
    // The story panel ends it and reports back, as the page's does.
    onEndStory: (id) => {
      const at = playing.indexOf(id);
      if (at >= 0) playing.splice(at, 1);
      guide.storyEnded(id);
    },
  });
  function place(): void {
    const [north, east] = spot;
    const accuracyM =
      precision === "gps" ? 4 : precision === "weak" ? 40 : null;
    visitor = {
      nue: [north, 401.5, east],
      gpsPoints: accuracyM === null ? [] : [{ latLongAccuracy: accuracyM }],
      fixNue: accuracyM === null ? null : [north, 400, east],
      aligned: true,
      fixAtMs: now,
      fixAccuracyM: accuracyM,
    };
    if (precision === "code") {
      r2.noDistance = false;
      r2.backAtMs = null;
    } else if (precision !== "gps") {
      r2.noDistance = true;
      r2.backAtMs = null;
    } else if (r2.noDistance) {
      r2.backAtMs ??= now;
      if (now - r2.backAtMs >= WALK_NO_GUESS_HOLD_MS) {
        r2.noDistance = false;
        r2.backAtMs = null;
      }
    }
    guide.tick();
  }
  const walk = () => store.getState().visitorWalk;
  const progress = () => walk().progress!;
  return {
    guide,
    dom,
    walk,
    progress,
    tick: place,
    stand(at: [number, number], p: Precision = precision) {
      spot = at;
      precision = p;
      place();
    },
    precision(p: Precision) {
      precision = p;
      place();
    },
    advance(ms: number) {
      now += ms;
      place();
    },
    complete: () => walkOffered(progress()).length === 0,
    /** No distance shown, or not yet back for the hold (the harness's
     *  own clock). */
    withoutDistance: () => r2.noDistance,
  };
}

const tourArb = fc.integer({ min: 2, max: 5 }).chain((n) =>
  fc.record({
    spots: fc.array(
      fc.tuple(
        fc.integer({ min: -150, max: 150 }),
        fc.integer({ min: -150, max: 150 }),
      ),
      { minLength: n, maxLength: n },
    ),
    order: fc.constantFrom<TourOrder>("any", "fixed", "branch"),
  }),
);

const TAPS: WalkRowTap[] = ["skip", "confirm", "cancel", "bring", "choose"];

const opArb = fc.oneof(
  fc.record({ kind: fc.constant("visit" as const), i: fc.nat(4) }),
  fc.record({ kind: fc.constant("far" as const) }),
  fc.record({
    kind: fc.constant("precision" as const),
    p: fc.constantFrom<Precision>("gps", "weak", "none", "code"),
  }),
  fc.record({
    kind: fc.constant("wait" as const),
    ms: fc.constantFrom(500, WALK_NO_GUESS_HOLD_MS, 7_000),
  }),
  fc.record({ kind: fc.constant("quick" as const) }),
  fc.record({ kind: fc.constant("end" as const) }),
  fc.record({
    kind: fc.constant("row" as const),
    i: fc.nat(4),
    tap: fc.constantFrom(...TAPS),
  }),
);

type Op = typeof opArb extends fc.Arbitrary<infer T> ? T : never;

function apply(
  h: ReturnType<typeof harness>,
  stations: TourStation[],
  spots: [number, number][],
  op: Op,
): void {
  switch (op.kind) {
    case "visit": {
      const i = op.i % stations.length;
      h.stand(spots[i]!);
      return;
    }
    case "far":
      h.stand(FAR);
      return;
    case "precision":
      h.precision(op.p);
      return;
    case "wait":
      h.advance(op.ms);
      return;
    case "quick":
      h.guide.skipTapped(h.dom.skip);
      return;
    case "end":
      h.guide.skipTapped(h.dom.end);
      return;
    case "row":
      h.guide.rowTapped(stations[op.i % stations.length]!.id, op.tap);
      return;
  }
}

describe("the walk's rules over random walks", () => {
  // How often the no-guess condition held at a check, over all runs.
  let r2Checks = 0;
  it("no deadlock, complete exactly when nothing is offered, found never reverts, one chosen target at most, no guess without a distance", () => {
    fc.assert(
      fc.property(
        tourArb,
        fc.array(opArb, { maxLength: 30 }),
        ({ spots, order }, ops) => {
          const stations = spots.map(([n, e], i) => station(i, n, e));
          const h = harness(stations, order);
          h.stand(FAR, "gps");
          const everFound = new Set<string>();
          const check = (): void => {
            const p = h.progress();
            // Finished only once complete (nothing offered); the line says
            // "Tour complete" exactly when finished: a tour completed by its
            // last station's end waits there first.
            expect(p.finished && !h.complete()).toBe(false);
            expect(h.dom.line.textContent.startsWith("Tour complete")).toBe(
              p.finished,
            );
            for (const s of stations) {
              const st = walkStatus(p, s.id)!;
              const found =
                st.state === "found" || (st.state === "done" && !st.skipped);
              expect(found || !everFound.has(s.id), s.id).toBe(true);
              if (found) everFound.add(s.id);
            }
            const w = h.walk();
            const chosen = w.chosenId;
            // At most one chosen target: a waiting offered station of an
            // any-order tour.
            expect(
              chosen === null ||
                (order === "any" &&
                  walkOffered(p).includes(chosen) &&
                  walkStatus(p, chosen)?.state === "waiting"),
              JSON.stringify(w),
            ).toBe(true);
            // The no-guess rule, derived here: an any-order tour with two or more
            // stations to find, no chosen target, and no distance shown
            // (or not yet back for the hold) guesses no station - no focus,
            // and a line that names none (a note of a skip may lead it).
            const toFind = walkOffered(p).filter(
              (id) => walkStatus(p, id)?.state !== "found",
            );
            const noGuess =
              order === "any" &&
              toFind.length >= 2 &&
              chosen === null &&
              h.withoutDistance();
            const line = h.dom.line.textContent.replace(
              /^(Skipped|Brought back) S\d+\. /,
              "",
            );
            if (noGuess) r2Checks += 1;
            expect(
              noGuess ? (h.guide.view()?.focusId ?? null) : null,
              line,
            ).toBeNull();
            expect(noGuess && /\bS\d+\b/.test(line), line).toBe(false);
          };
          check();
          for (const op of ops) {
            apply(h, stations, spots, op);
            check();
          }
          // No deadlock: the visitor ends each story and skips each
          // station still to find, from wherever the walk stands, and
          // finishes a complete tour that waits on its last station.
          for (let round = 0; round < 4 * stations.length + 5; round += 1) {
            h.advance(500);
            if (h.progress().finished) break;
            if (h.complete()) {
              h.guide.skipTapped(h.dom.skip);
              check();
              continue;
            }
            const p = h.progress();
            const offered = walkOffered(p);
            const found = offered.find(
              (id) => walkStatus(p, id)?.state === "found",
            );
            if (found !== undefined) {
              h.guide.skipTapped(h.dom.end);
              h.guide.skipTapped(h.dom.end);
            } else {
              const id = offered[0]!;
              h.guide.rowTapped(id, "skip");
              h.guide.rowTapped(id, "confirm");
            }
            check();
          }
          h.tick();
          expect(h.complete()).toBe(true);
          expect(h.progress().finished).toBe(true);
          expect(h.dom.line.textContent).toMatch(/^Tour complete/);
        },
      ),
      { numRuns: 600 },
    );
    // Not vacuous: the no-guess condition was reached and checked often.
    // The count depends on the random walks. With a code among the
    // precisions it ends the condition at once, so 300 walks reached it
    // 75 to 197 times over 24 seeds (mean 115, sd 29) - a floor of 60
    // there would fail about one run in thirty; 600 walks reach it 167 to
    // 299 times over 22 seeds (mean 239, sd 34), five deviations above
    // the floor (2026-10-22). It guards against the condition never or
    // rarely being reached, not against a number.
    expect(r2Checks).toBeGreaterThan(60);
    // 600 random walks: 3.0 s on an idle machine, 6.6 s in a loaded
    // gate run and 13.4 s alone under load (2026-10-26), past the default
    // 5 s. The time out is for a hang, not for a slow machine.
  }, 30_000);

  // "No order can deadlock", re-stated over the story card and the no-guess rule's three tap paths: "Can't get
  // there?" then the armed row's confirm, "Can't get there?" then a row in
  // the chooser, and a row's Skip then its confirm - each two taps; a
  // found station's story ends in two taps on its card. Finishing the
  // tour is one tap more ("Finish the tour" on the peek) unless a skip
  // completed it, which finishes it at once (no presence in this harness,
  // so leaving the last station never finishes it here).
  it("every tour finishes within two taps per station plus one, over the three tap paths and any precision", () => {
    fc.assert(
      fc.property(
        tourArb,
        fc.constantFrom<Precision>("gps", "weak", "none", "code"),
        fc.array(fc.constantFrom("quick", "row"), {
          minLength: 5,
          maxLength: 5,
        }),
        fc.array(fc.nat(4), { maxLength: 3 }),
        ({ spots, order }, precision, paths, visits) => {
          const stations = spots.map(([n, e], i) => station(i, n, e));
          const h = harness(stations, order);
          h.stand(FAR, "gps");
          // Some stations found first: their stories play and never end.
          for (const i of visits) h.stand(spots[i % stations.length]!, "gps");
          h.stand(FAR, precision);
          h.advance(WALK_NO_GUESS_HOLD_MS);
          let taps = 0;
          const tap = (fn: () => void): void => {
            taps += 1;
            fn();
          };
          for (let round = 0; round < 2 * stations.length + 2; round += 1) {
            if (h.complete()) break;
            const p = h.progress();
            const offered = walkOffered(p);
            const found = offered.find(
              (id) => walkStatus(p, id)?.state === "found",
            );
            if (found !== undefined) {
              tap(() => h.guide.skipTapped(h.dom.end));
              tap(() => h.guide.skipTapped(h.dom.end));
            } else if (paths[round % paths.length] === "quick") {
              tap(() => h.guide.skipTapped(h.dom.skip));
              const w = h.walk();
              // Armed: the row's confirm; the chooser: any row's Skip.
              const id = w.rowArmedId ?? offered[0]!;
              tap(() =>
                h.guide.rowTapped(
                  id,
                  w.rowArmedId === null ? "skip" : "confirm",
                ),
              );
            } else {
              const id = offered[0]!;
              tap(() => h.guide.rowTapped(id, "skip"));
              if (walkStatus(h.progress(), id)?.state !== "done") {
                tap(() => h.guide.rowTapped(id, "confirm"));
              }
            }
            // Past the undo's window: inside it the quick action offers
            // the undo, not "Can't get there?" (as the R9 property waits).
            h.advance(SKIP_UNDO_MS + 1_000);
          }
          expect(h.complete()).toBe(true);
          expect(taps).toBeLessThanOrEqual(2 * stations.length);
          // Complete but not finished: the quick action finishes it.
          const waiting = !h.progress().finished;
          expect(waiting ? h.dom.skip.dataset["action"] : "finish-tour").toBe(
            "finish-tour",
          );
          if (waiting) tap(() => h.guide.skipTapped(h.dom.skip));
          expect(h.progress().finished).toBe(true);
          expect(taps).toBeLessThanOrEqual(2 * stations.length + 1);
        },
      ),
      { numRuns: 300 },
    );
  });
});
