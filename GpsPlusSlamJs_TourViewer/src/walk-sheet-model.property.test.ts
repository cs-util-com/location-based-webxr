import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  TourOrder,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-stations";
import { calcGpsCoords } from "gps-plus-slam-app-framework/core";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import { wireStationGuide } from "./station-guide";
import { walkOffered, walkStatus, type WalkStep } from "./station-run";
import { createTourViewerStore } from "./tour-viewer-session";
import type { VisitorPosition } from "./visitor-position";
import { walkStepped } from "./visitor-walk-slice";
import { walkSheetModel } from "./walk-sheet-model";

/**
 * Why these properties matter: the peek is a split of the hidden station line, which the
 * screen reader and the e2e still read - the two must name the same
 * station and say the same about the position, for every walk and every
 * measurement, or the visitor sees one thing and hears another. The
 * segments and the rows are one answer drawn twice, and the sheet never
 * names a station the run does not offer as the next.
 */

createSlamAppStore({ storageBackend: new NullStorageBackend() });

const zero = { lat: 47.5, lon: 8.7 };

function station(
  id: string,
  title: string,
  north: number,
  east: number,
): TourStation {
  const geo = calcGpsCoords(zero, [north, 0, east]);
  return {
    id,
    title,
    geo: { lat: geo.lat, lon: geo.lon, alt: 400, headingDeg: 0 },
    activateRadiusM: 30,
    foundRadiusM: 10,
    hint: "arrow",
    steps: [
      {
        id: "s",
        block: { kind: "text", text: "Hi" },
        advance: { mode: "tap" },
      },
    ],
    items: [],
  };
}

// The prototype's tour (x east, z south): the gate, the well, the tower,
// the garden.
const TOUR = [
  station("gate", "The gate", 28, 0),
  station("well", "The well", 82, 34),
  station("tower", "The tower", 170, -48),
  station("garden", "The garden", 240, 46),
];
const IDS = TOUR.map((s) => s.id);

const stepArb: fc.Arbitrary<WalkStep> = fc.oneof(
  fc.record({
    kind: fc.constantFrom("found", "finish", "skip", "unskip"),
    id: fc.constantFrom(...IDS),
  }) as fc.Arbitrary<WalkStep>,
);

/** A measurement: where the visitor stands and what vouches for it. */
const measurementArb = fc.record({
  north: fc.integer({ min: -20, max: 260 }),
  east: fc.integer({ min: -60, max: 60 }),
  /** null: no fix states an accuracy (nothing vouches for the position);
   *  above 25 m: GPS too weak to guide by. */
  accuracyM: fc.option(fc.constantFrom(4, 12, 40), { nil: null }),
  /** No position at all (a dropped pose). */
  lost: fc.boolean(),
});

type Measurement =
  typeof measurementArb extends fc.Arbitrary<infer T> ? T : never;

/** The line each peek kind must agree with. */
function linePattern(peek: { kind: string; title: string }): RegExp {
  switch (peek.kind) {
    case "complete":
      return /^Tour complete/;
    case "story":
      return /Station found - its story is playing\.$/;
    case "none":
      // No station guessed: the line names the count and the
      // position's state, as the peek's title does.
      return new RegExp(`^${peek.title} - `);
    default:
      return new RegExp(`(: |Next: )${peek.title}`);
  }
}

function guideOver(order: TourOrder) {
  const store = createTourViewerStore();
  let visitor: VisitorPosition = {
    nue: null,
    gpsPoints: [],
    fixNue: null,
    aligned: false,
    fixAtMs: null,
    fixAccuracyM: null,
  };
  const dom = {
    line: { textContent: "", hidden: true },
    skip: { textContent: "", hidden: true, dataset: {} as DOMStringMap },
    end: { textContent: "", hidden: true, dataset: {} as DOMStringMap },
  };
  const guide = wireStationGuide({
    dom,
    tour: () => ({ stations: TOUR, order }),
    placementAllowed: () => true,
    zero: () => zero,
    visitor: () => visitor,
    codeLinedUp: () => false,
    alignmentReady: () => true,
    trackingReady: () => true,
    startHud: () => ({ dispose: () => undefined }),
    now: () => 1_000_000,
    walkStore: store,
    onFound: () => undefined,
  });
  return {
    store,
    guide,
    dom,
    stand(m: Measurement) {
      visitor = m.lost
        ? { ...visitor, nue: null, fixNue: null, aligned: true }
        : {
            nue: [m.north, 401.5, m.east],
            gpsPoints:
              m.accuracyM === null ? [] : [{ latLongAccuracy: m.accuracyM }],
            fixNue: [m.north, 400, m.east],
            aligned: true,
            fixAtMs: 1_000_000,
            fixAccuracyM: m.accuracyM,
          };
    },
  };
}

describe("the sheet against the hidden line and the run", () => {
  it("the peek and the line name the same station and say the same; nothing named is not offered", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<TourOrder>("any", "fixed", "branch"),
        fc.array(stepArb, { maxLength: 10 }),
        measurementArb,
        (order, steps, m) => {
          const h = guideOver(order);
          h.guide.tick(); // the walk starts
          for (const s of steps) h.store.dispatch(walkStepped(s));
          h.stand(m);
          h.guide.tick();
          const view = h.guide.view();
          const progress = h.store.getState().visitorWalk.progress;
          expect(view).not.toBeNull();
          expect(progress).not.toBeNull();
          if (view === null || progress === null) return;
          const offered = walkOffered(progress);
          const model = walkSheetModel({
            stations: TOUR,
            order,
            tourTitle: "Old town walk",
            progress,
            view,
            story: null,
            sheet: "peek",
          });
          const line = h.dom.line.textContent;
          const { peek } = model;
          expect(line).toMatch(linePattern(peek));
          // A station the peek names is offered and still to find.
          const named =
            peek.kind === "walk"
              ? TOUR.find((s) => s.title === peek.title)
              : undefined;
          expect(peek.kind !== "walk" || named !== undefined).toBe(true);
          const namedState =
            named === undefined
              ? "waiting"
              : offered.includes(named.id)
                ? walkStatus(progress, named.id)?.state
                : "not offered";
          expect(namedState).toBe("waiting");
          // The distance shows exactly when the line shows one.
          const lineDistance = /, (\d+(?:\.\d+)? k?m)$/.exec(line)?.[1] ?? null;
          expect(peek.distance).toBe(
            peek.kind === "walk" ? lineDistance : null,
          );
          const next = model.list.rows.filter((r) => r.state === "next");
          expect(next.length).toBeLessThanOrEqual(1);
          for (const r of next) expect(offered).toContain(r.id);
          // The segments are the rows' states, drawn twice.
          expect(model.segments).toEqual({
            kind: "each",
            states: model.list.rows.map((r) => r.state),
          });
        },
      ),
      { numRuns: 300 },
    );
  });
});
