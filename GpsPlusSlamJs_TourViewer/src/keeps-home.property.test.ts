/**
 * Why these tests matter: an item moved a little past its station's
 * circle (a typed offset, an AR settle's noise) used to start a station
 * of its own at once - the rule was strict. A tolerance fixes that, but
 * measured from the item's previous place it lets a run of small nudges
 * creep outward without bound, each one "only a little farther". So the
 * tolerance is measured from the circle itself: an item keeps its
 * station while it stands within the found radius plus the tolerance, or
 * no farther out than it stood before the move (an item left outside by
 * a smaller radius). These check that no sequence of nudges carries an
 * item beyond that bound, swept over tolerances from 0 to 1 m, and the
 * same through the tour document's own reducer at the chosen 0.5 m.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  TourObject,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { calcGpsCoords } from "gps-plus-slam-app-framework/core";

import { inspectorEdit } from "./editor/editor-shell/inspector-edits.js";
import {
  KEEPS_HOME_START_SLACK_M,
  KEEPS_HOME_TOLERANCE_M,
  keepsHomeDistance,
} from "./keeps-home.js";
import { horizontalM } from "./move-with-code.js";
// Activates the licence the geodesy below needs (as every v3 tour test).
import "./test-support/tour-of.js";
import {
  documentObjects,
  initialTourDocumentState,
  manifestToWrite,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type TourDocumentState,
} from "./tour-document.js";

const RADIUS_M = 25;

/** A point `north` m north and `east` m east of (48.6, 9.1), at 400 m. */
function spot(north: number, east = 0): TourObject["geo"] {
  const g = calcGpsCoords({ lat: 48.6, lon: 9.1 }, [north, 0, east]);
  return { lat: g.lat, lon: g.lon, alt: 400, rotation: [0, 0, 0, 1] };
}

function station(id: string, north: number): TourStation {
  const { lat, lon, alt } = spot(north);
  return {
    id,
    geo: { lat, lon, alt, rotation: [0, 0, 0, 1] },
    activateRadiusM: 2 * RADIUS_M,
    foundRadiusM: RADIUS_M,
    hint: "arrow",
    steps: [],
    blocks: [],
  };
}

/** A tour with station s, and a pin p of s at `north` m (and `east`). */
function withPin(north: number, east = 0): TourDocumentState {
  const opened = reduce(
    initialTourDocumentState,
    act.opened({
      manifest: {
        version: 4,
        minor: 0,
        order: "fixed",
        assets: [],
        stations: [station("s", 0)],
      },
    }),
  );
  return reduce(
    opened,
    act.placed({
      object: {
        id: "p",
        kind: "shortText",
        view: "pin",
        caption: "p",
        createdAtIso: "2026-10-25T00:00:00.000Z",
        geo: spot(north, east),
        station: "s",
      },
      what: "p",
      newStationId: "new-p",
    }),
  );
}

function pinOf(state: TourDocumentState): TourObject {
  const found = documentObjects(state).find((o) => o.object.id === "p");
  if (found === undefined) throw new Error("no pin");
  return found.object;
}

function moveTo(state: TourDocumentState, geo: TourObject["geo"]) {
  return reduce(
    state,
    act.moved({
      object: { ...pinOf(state), geo },
      what: "m",
      newStationId: `moved-${String(state.revision)}`,
    }),
  );
}

const anchor = spot(0);

describe("keepsHomeDistance", () => {
  for (const toleranceM of [0, 0.1, 0.5, 1]) {
    it(`never lets a run of nudges carry an item past its circle and ${String(toleranceM)} m, or past where it started outside it (property)`, () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 60, noNaN: true }),
          fc.array(fc.double({ min: -0.6, max: 0.6, noNaN: true }), {
            maxLength: 200,
          }),
          (startM, nudges) => {
            // Outside the circle, each move may end its slack farther out
            // than it started: never more than that a move.
            const bound =
              Math.max(startM, RADIUS_M + toleranceM) +
              nudges.length * KEEPS_HOME_START_SLACK_M;
            let at = startM;
            for (const nudge of nudges) {
              const next = Math.max(0, at + nudge);
              const kept = keepsHomeDistance(
                { radiusM: RADIUS_M, wasM: at, nowM: next },
                toleranceM,
              );
              // Not kept: the rule seats it anew, and this run ends.
              if (!kept) return;
              at = next;
              expect(at).toBeLessThanOrEqual(bound);
            }
          },
        ),
        { numRuns: 300 },
      );
    });
  }

  it("keeps an item within the circle and the tolerance, or no farther out than it was; nothing else", () => {
    const at = (wasM: number, nowM: number) =>
      keepsHomeDistance({ radiusM: RADIUS_M, wasM, nowM }, 0.5);
    expect(at(24, 25.5)).toBe(true);
    expect(at(24, 25.51)).toBe(false);
    expect(at(40, 39)).toBe(true);
    expect(at(40, 40)).toBe(true);
    // A millimetre past the start is rounding (a pose through the
    // station's frame and back), not a move outward.
    expect(at(40, 40.0009)).toBe(true);
    expect(at(40, 40.0011)).toBe(false);
    expect(at(40, 40.01)).toBe(false);
    expect(KEEPS_HOME_START_SLACK_M).toBe(0.001);
    expect(keepsHomeDistance({ radiusM: RADIUS_M, wasM: 0, nowM: 25.4 })).toBe(
      true,
    );
    expect(KEEPS_HOME_TOLERANCE_M).toBe(0.5);
  });

  it("refuses what is no distance: keeps nothing for a NaN or a negative", () => {
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(keepsHomeDistance({ radiusM: RADIUS_M, wasM: 1, nowM: bad })).toBe(
        false,
      );
      expect(keepsHomeDistance({ radiusM: bad, wasM: 1, nowM: 1 })).toBe(false);
    }
  });
});

describe("moved: an item past its circle", () => {
  // Why: the strict rule started a station of its own for an item a typed
  // offset or an AR settle put a few centimetres past the circle.
  it("keeps its station within 0.5 m past the circle; farther, the rule seats it", () => {
    const inside = withPin(20);
    expect(pinOf(moveTo(inside, spot(25.4))).station).toBe("s");
    expect(pinOf(moveTo(inside, spot(25.7))).station).not.toBe("s");
  });

  it("never creeps outward through a run of nudges, at the chosen tolerance (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 24, noNaN: true }),
        fc.array(fc.double({ min: -0.3, max: 0.6, noNaN: true }), {
          minLength: 1,
          maxLength: 40,
        }),
        (startM, nudges) => {
          let state = withPin(startM);
          let north = startM;
          for (const nudge of nudges) {
            north += nudge;
            state = moveTo(state, spot(north));
            const p = pinOf(state);
            if (p.station !== "s") return;
            expect(horizontalM(anchor, p.geo)).toBeLessThanOrEqual(
              RADIUS_M + KEEPS_HOME_TOLERANCE_M + 1e-6,
            );
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("stationEdited: a radius lowered under its items", () => {
  // Why: lowering a radius must not move content between stations
  // behind the creator's back. The item stays in its station, where it
  // stood, outside the circle (the inspector says so) until it is moved.
  it("leaves every item in its station where it stands, at any radius (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 24, noNaN: true }),
        fc.double({ min: 2, max: 300, noNaN: true }),
        (north, radiusM) => {
          const before = withPin(north);
          const after = reduce(
            before,
            act.stationEdited({
              stationId: "s",
              edit: { foundRadiusM: radiusM },
              what: "radius",
            }),
          );
          expect(pinOf(after).station).toBe("s");
          expect(pinOf(after).geo).toEqual(pinOf(before).geo);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("then keeps the item in its station through a move about outside the circle, and seats it once moved farther out", () => {
    const lowered = reduce(
      withPin(20),
      act.stationEdited({
        stationId: "s",
        edit: { foundRadiusM: 5 },
        what: "radius",
      }),
    );
    expect(pinOf(moveTo(lowered, spot(19))).station).toBe("s");
    expect(pinOf(moveTo(lowered, spot(20, 1))).station).not.toBe("s");
  });
});

describe("a typed height of an item outside a lowered circle", () => {
  // Why: a typed Height used to be written as a whole new pose, through
  // the station's frame and back; its float32 maths moved the item
  // sideways by up to a micrometre, outward about half the time, and an
  // item outside a lowered circle then got a station of its own with
  // nothing said. A height changes the altitude, and the item stays.
  it("keeps the item in its station, where it stands (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 8, max: 20, noNaN: true }),
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        fc.double({ min: -3, max: 3, noNaN: true }),
        (distanceM, bearing, heightM) => {
          const lowered = reduce(
            withPin(
              distanceM * Math.cos(bearing),
              distanceM * Math.sin(bearing),
            ),
            act.stationEdited({
              stationId: "s",
              edit: { foundRadiusM: 5 },
              what: "radius",
            }),
          );
          const before = pinOf(lowered);
          const typed = inspectorEdit({
            selected: "p",
            stations: manifestToWrite(lowered)?.stations ?? [],
            origin: null,
            field: "height",
            value: heightM.toFixed(2),
          });
          // Written as the page writes each kind of edit.
          const after =
            typed.kind === "height"
              ? reduce(
                  lowered,
                  act.itemsGrounded({
                    items: [{ id: typed.id, alt: typed.alt }],
                    what: "h",
                  }),
                )
              : typed.kind === "scene" && typed.edit.kind === "item-pose"
                ? reduce(
                    lowered,
                    act.moved({
                      object: { ...before, geo: typed.edit.geo },
                      what: "h",
                      newStationId: "made",
                    }),
                  )
                : lowered;
          const pin = pinOf(after);
          expect(pin.station).toBe("s");
          expect([pin.geo.lat, pin.geo.lon]).toEqual([
            before.geo.lat,
            before.geo.lon,
          ]);
        },
      ),
      { numRuns: 200 },
    );
  });
});
