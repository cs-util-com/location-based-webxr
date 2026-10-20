import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type {
  TourManifest,
  TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { calcGpsCoords } from "gps-plus-slam-app-framework/core";
import { Group, Mesh, type RingGeometry, type Vector3 } from "three";

import { createCreatorDocument } from "./creator-document.js";
import { tourOf } from "./test-support/v3-tour.js";
import { withWalkPhotos } from "./tour-content.js";
import {
  manifestToWrite,
  tourDocumentActions,
  tourDocumentReducer,
} from "./tour-document.js";
import { createTourViewerStore } from "./tour-viewer-session.js";
import {
  openStationAt,
  placedInText,
  reticleNueOf,
  stationChipText,
  stationsAsFinished,
  wireCreatorStations,
  type ArStation,
} from "./creator-stations.js";
import { STATION_RING_NAME } from "./station-ring.js";

/**
 * Why these tests matter (tour editor plan 2026-10-17-1816, W3 "AR
 * authoring", D20, D21): the creator decides where a station ends by what
 * the HUD says and the ring shows. If the HUD's stations were not the ones
 * the tour document seats a placement in, a pin the HUD said "joins
 * Station 2" would land in a new station - silently, discovered only by a
 * visitor. So the stations are read from the document as its next write
 * carries them, judged by each station's own found radius, and the HUD's
 * promise is a property: a pin placed where the creator stands lands in
 * the station the HUD called open, or starts a new one when it called
 * none.
 */

/** `manifest` with every station's found radius `radiusM` (the radius
 *  the HUD and the document's rule read; swept by the properties). */
function withRadius(manifest: TourManifest, radiusM?: number): TourManifest {
  if (radiusM === undefined) return manifest;
  return {
    ...manifest,
    stations: manifest.stations.map((s) => ({ ...s, foundRadiusM: radiusM })),
  };
}

const zero = { lat: 47.5, lon: 8.7 };

/** A pin `north`/`east` metres from the zero. */
function pin(id: string, north: number, east: number): TourObject {
  const g = calcGpsCoords(zero, [north, 0, east]);
  return {
    id,
    kind: "pin",
    label: id,
    createdAtIso: "2026-10-18T00:00:00.000Z",
    geo: { lat: g.lat, lon: g.lon, alt: 400, headingDeg: 0 },
  };
}

function at(north: number, east: number): { lat: number; lon: number } {
  return calcGpsCoords(zero, [north, 0, east]);
}

/** The station holding `id`. */
function stationOf(
  stations: readonly ArStation[],
  id: string,
): ArStation | undefined {
  return stations.find((s) => s.itemIds.includes(id));
}

/** The stations of a tour document holding `manifest` (its stations'
 *  found radius `radiusM` when given) with this page's placements and
 *  deletions (null: no tour). */
function finishedOf(input: {
  readonly manifest: TourManifest | null;
  readonly placed: readonly TourObject[];
  readonly deleted: readonly string[];
  readonly radiusM?: number;
}): ArStation[] {
  if (input.manifest === null) return stationsAsFinished({ state: null });
  let state = tourDocumentReducer(
    undefined,
    tourDocumentActions.opened({
      manifest: withRadius(input.manifest, input.radiusM),
    }),
  );
  // A refused change would make a test pass for the wrong reason: the
  // document ignores it, so each is checked here (the review's LOW-6).
  for (const id of input.deleted) {
    const before = state;
    state = tourDocumentReducer(
      state,
      tourDocumentActions.deleted({ id, what: "a deletion" }),
    );
    if (state.revision === before.revision) {
      throw new Error(`the document refused the deletion of ${id}`);
    }
  }
  for (const object of input.placed) {
    const before = state;
    state = tourDocumentReducer(
      state,
      // A station id per object, so two runs over one walk agree.
      tourDocumentActions.placed({
        object,
        what: "a pin",
        newStationId: `new-${object.id}`,
      }),
    );
    if (state.revision === before.revision) {
      throw new Error(`the document refused the placement of ${object.id}`);
    }
  }
  return stationsAsFinished({ state });
}

describe("stationsAsFinished", () => {
  it("is the document's assignment: a pin within the radius joins the station, one beyond starts a new one, named by its place", () => {
    const manifest = tourOf([pin("gate", 0, 0)]);
    const stations = finishedOf({
      manifest,
      placed: [pin("near", 10, 0), pin("far", 60, 0), pin("farther", 70, 0)],
      deleted: [],
    });
    expect(stations.map((s) => s.name)).toEqual(["Station 1", "Station 2"]);
    expect(stationOf(stations, "near")?.id).toBe("st-gate");
    expect(stationOf(stations, "near")?.started).toBe(false);
    const started = stationOf(stations, "far")!;
    expect(started.started).toBe(true);
    // The anchor is the first element's spot (D20), the next joins it.
    expect(started.itemIds).toEqual(["far", "farther"]);
    expect(started.anchor.lat).toBeCloseTo(at(60, 0).lat, 9);
  });

  it("names a titled station by its title, drops what this page deleted, and has nothing without a tour", () => {
    const base = tourOf([pin("gate", 0, 0)]);
    const manifest: TourManifest = {
      ...base,
      stations: base.stations.map((s) => ({ ...s, title: "The gate" })),
    };
    const stations = finishedOf({
      manifest,
      placed: [pin("near", 5, 0)],
      deleted: ["gate"],
    });
    expect(stations.map((s) => s.name)).toEqual(["The gate"]);
    expect(stations[0]!.itemIds).toEqual(["near"]);
    expect(finishedOf({ manifest: null, placed: [], deleted: [] })).toEqual([]);
  });

  it("tells a station the file carries from one this page started, whatever its id", () => {
    // A hosted station could carry any id: "started" is whether the tour
    // file carries the station, never a reading of its id.
    const hosted = tourOf([pin("gate", 0, 0)]);
    const manifest: TourManifest = {
      ...hosted,
      stations: hosted.stations.map((s) => ({ ...s, id: "unwritten-1" })),
    };
    const stations = finishedOf({
      manifest,
      placed: [pin("far", 60, 0)],
      deleted: [],
    });
    expect(stations.map((s) => s.started)).toEqual([false, true]);
    expect(new Set(stations.map((s) => s.id)).size).toBe(2);
  });
});

describe("openStationAt", () => {
  it("is the nearest station whose own radius holds the spot, the radius itself inside, none beyond", () => {
    const stations = finishedOf({
      manifest: tourOf([pin("a", 0, 0), pin("b", 40, 0)]),
      placed: [],
      deleted: [],
    });
    expect(openStationAt(stations, at(24, 0))?.id).toBe("st-b");
    expect(openStationAt(stations, at(10, 0))?.id).toBe("st-a");
    expect(openStationAt(stations, at(0, 25))?.id).toBe("st-a");
    expect(openStationAt(stations, at(0, 26))).toBeNull();
    // A station's own radius decides: 35 m holds 30 m, 5 m does not hold 6.
    const wide = finishedOf({
      manifest: tourOf([pin("a", 0, 0)]),
      placed: [],
      deleted: [],
      radiusM: 35,
    });
    expect(openStationAt(wide, at(0, 30))?.id).toBe("st-a");
    const narrow = finishedOf({
      manifest: tourOf([pin("a", 0, 0)]),
      placed: [],
      deleted: [],
      radiusM: 5,
    });
    expect(openStationAt(narrow, at(0, 6))).toBeNull();
  });

  it("keeps the HUD's promise: a pin placed where the creator stands lands in the open station, or starts one where none is open (property)", () => {
    // D21: "Place a pin" with no station open creates a station holding
    // it; inside one it joins it. Checked along random walks, each pin
    // placed at the creator's spot.
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.integer({ min: -120, max: 120 }),
            fc.integer({ min: -120, max: 120 }),
          ),
          { minLength: 1, maxLength: 12 },
        ),
        fc.integer({ min: 15, max: 40 }),
        (walk, radiusM) => {
          const manifest = tourOf([pin("hosted", 0, 0)]);
          const placed: TourObject[] = [];
          for (const [i, [north, east]] of walk.entries()) {
            const before = finishedOf({
              manifest,
              placed,
              deleted: [],
              radiusM,
            });
            const open = openStationAt(before, at(north, east));
            const id = `p${String(i)}`;
            placed.push(pin(id, north, east));
            const after = finishedOf({
              manifest,
              placed,
              deleted: [],
              radiusM,
            });
            const home = stationOf(after, id)!;
            // Inside the open station it joins it, never moving its anchor
            // (D20); with none open it starts one, as its first element.
            const outcome =
              open === null
                ? {
                    started: home.started,
                    first: home.itemIds[0],
                    note: placedInText(after, id),
                  }
                : { id: home.id, anchor: home.anchor };
            const promised =
              open === null
                ? { started: true, first: id, note: `it starts ${home.name}` }
                : { id: open.id, anchor: open.anchor };
            expect(outcome).toEqual(promised);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("the words", () => {
  const station = (name: string, started = false): ArStation => ({
    id: name,
    anchor: { lat: 47.5, lon: 8.7, alt: 400 },
    foundRadiusM: 25,
    name,
    started,
    itemIds: ["first", "second"],
  });

  it("says which station the creator is in, that they left it, or that none is here", () => {
    expect(stationChipText(station("Station 2"), null)).toBe(
      "In Station 2 - what you place here joins it.",
    );
    expect(stationChipText(null, station("The well"))).toBe(
      "You left The well - what you place next starts a new station.",
    );
    expect(stationChipText(null, null)).toBe(
      "No station here - what you place next starts a new one.",
    );
  });

  // Why (owner decision D8): while "New station here" is armed, the line
  // must not say "what you place here joins it" - the next item starts a
  // station of its own, wherever the creator stands.
  it("says the next item starts a new station here while 'New station here' is armed", () => {
    const armed = "What you place next starts a new station here.";
    expect(stationChipText(station("Station 2"), null, true)).toBe(armed);
    expect(stationChipText(null, station("The well"), true)).toBe(armed);
    expect(stationChipText(null, null, true)).toBe(armed);
  });

  it("says a placement started a station only for its first element", () => {
    const stations = [station("Station 3", true), station("Station 1")];
    expect(placedInText(stations, "first")).toBe("it starts Station 3");
    expect(placedInText(stations, "second")).toBe("in Station 3");
    expect(placedInText([station("Station 1")], "first")).toBe("in Station 1");
    expect(placedInText(stations, "nowhere")).toBeNull();
  });
});

describe("reticleNueOf", () => {
  // Why: the open station is judged where the reticle points only while it
  // is visible; a hidden or broken reticle must fall back to the creator.
  const reticle = (visible: boolean, at: [number, number, number]) => ({
    isVisible: () => visible,
    getWorldPosition: (out: Vector3) => out.set(...at),
  });

  it("is the visible reticle's hit point, and null when hidden, absent or not finite", () => {
    expect(reticleNueOf(reticle(true, [3, 400.5, -2]))).toEqual([3, 400.5, -2]);
    expect(reticleNueOf(reticle(false, [3, 400.5, -2]))).toBeNull();
    expect(reticleNueOf(null)).toBeNull();
    expect(reticleNueOf(reticle(true, [Number.NaN, 0, 0]))).toBeNull();
  });
});

describe("wireCreatorStations", () => {
  function harness(options: { radiusM?: number; opened?: TourManifest } = {}) {
    const scene = new Group();
    // The page's tour document, changed as the creator changes it (a
    // placement, a settle's re-pose, a delete, a Finish's write).
    const tour = createCreatorDocument(createTourViewerStore());
    tour.open(
      options.opened ??
        withRadius(tourOf([pin("gate", 0, 0)]), options.radiusM),
    );
    const chip = { textContent: "", hidden: true };
    let creator: [number, number, number] | null = [5, 401.5, 0];
    let reticle: [number, number, number] | null = null;
    let sceneNow: Group | null = scene;
    const stations = wireCreatorStations({
      tour,
      dom: { chip },
      creatorNue: () => creator,
      reticleNue: () => reticle,
      zero: () => zero,
      scene: () => sceneNow,
    });
    const ring = () =>
      scene.children.find((c) => c.name === STATION_RING_NAME) as
        Mesh | undefined;
    return {
      tour,
      chip,
      stations,
      ring,
      stand: (north: number, east: number, up = 401.5) => {
        creator = [north, up, east];
        stations.tick();
      },
      lose: () => {
        creator = null;
        stations.tick();
      },
      /** The reticle on the ground at north/east, or hidden (null). */
      aim: (at: readonly [number, number] | null) => {
        reticle = at === null ? null : [at[0], 400, at[1]];
      },
      noScene: () => {
        sceneNow = null;
      },
    };
  }

  it("names the open station and rings its radius on the ground at its anchor", () => {
    const h = harness();
    h.stand(5, 0);
    expect(h.chip.hidden).toBe(false);
    expect(h.chip.textContent).toBe(
      "In Station 1 - what you place here joins it.",
    );
    const ring = h.ring();
    expect(ring).toBeInstanceOf(Mesh);
    // At the anchor (the zero here), on the ground 1.5 m below the phone.
    expect(ring!.position.x).toBeCloseTo(0, 6);
    expect(ring!.position.y).toBeCloseTo(400, 6);
    expect(ring!.position.z).toBeCloseTo(0, 6);
    const { innerRadius, outerRadius } = (ring!.geometry as RingGeometry)
      .parameters;
    expect((innerRadius + outerRadius) / 2).toBeCloseTo(25, 9);
  });

  it("closes the station on leaving its radius: the line says so and the ring goes", () => {
    const h = harness();
    h.stand(5, 0);
    h.stand(30, 0);
    expect(h.chip.textContent).toBe(
      "You left Station 1 - what you place next starts a new station.",
    );
    expect(h.ring()).toBeUndefined();
    // Back inside: open again, with its ring.
    h.stand(20, 0);
    expect(h.chip.textContent).toMatch(/^In Station 1/);
    expect(h.ring()).toBeDefined();
  });

  it("says where a placement went: a pin outside every radius starts a new station, one inside joins it", () => {
    const h = harness();
    h.stand(5, 0);
    h.stand(60, 0);
    expect(h.chip.textContent).toBe(
      "You left Station 1 - what you place next starts a new station.",
    );
    h.tour.place(pin("far", 60, 0), {}, "a pin");
    expect(h.stations.placedIn("far")).toBe("it starts Station 2");
    h.stand(60, 0);
    expect(h.chip.textContent).toBe(
      "In Station 2 - what you place here joins it.",
    );
    h.tour.place(pin("next", 62, 0), {}, "a pin");
    expect(h.stations.placedIn("next")).toBe("in Station 2");
  });

  // Why (owner decision D8): "New station here" is a flag of the tour
  // document; the line follows it on the next frame, and the placement it
  // armed starts its own station 2 m from the gate's anchor, which the
  // note names by its station's name (`nameOf`).
  it("follows 'New station here': the line while armed, the new station named after the placement", () => {
    const h = harness();
    h.stand(5, 0);
    h.tour.armNewStation(true);
    h.stand(5, 0);
    expect(h.chip.textContent).toBe(
      "What you place next starts a new station here.",
    );
    // The ring stays the station the creator stands in.
    expect(h.ring()).toBeDefined();
    // As the placement takes the arm (`creator-placement.ts`).
    h.tour.armNewStation(false);
    h.tour.place(pin("own", 2, 0), { ownStation: true }, "a pin");
    expect(h.stations.placedIn("own")).toBe("it starts Station 2");
    expect(h.stations.nameOf("own")).toBe("Station 2");
    expect(h.stations.nameOf("gate")).toBe("Station 1");
    expect(h.stations.nameOf("nowhere")).toBeNull();
    h.stand(2, 0);
    expect(h.chip.textContent).toBe(
      "In Station 2 - what you place here joins it.",
    );
  });

  it("says nothing and draws nothing without a position, a scene or a tour, and after the visit", () => {
    const h = harness();
    h.stand(5, 0);
    h.lose();
    expect(h.chip.hidden).toBe(true);
    expect(h.ring()).toBeUndefined();
    h.stand(5, 0);
    h.stations.endVisit();
    expect(h.chip.hidden).toBe(true);
    expect(h.ring()).toBeUndefined();
    h.tour.close();
    h.stand(5, 0);
    expect(h.chip.hidden).toBe(true);
    const g = harness();
    g.noScene();
    g.stand(5, 0);
    expect(g.chip.hidden).toBe(true);
  });

  // Why: the settle re-poses placed objects by replacing entries IN the
  // working copy's array (`creator-settle.ts`: same array, same length). A
  // HUD that only noticed a new array or a new length kept the pre-settle
  // stations, and its line and ring disagreed with the Finish.
  it("follows a settle that re-poses a placement in place", () => {
    const h = harness();
    h.tour.place(pin("far", 60, 0), {}, "a pin");
    h.stand(60, 0);
    expect(h.chip.textContent).toBe(
      "In Station 2 - what you place here joins it.",
    );
    // 40 m on, beyond its station's 25 m radius: the document seats it in
    // a station there, and the one it left, now empty, goes.
    h.tour.move(pin("far", 100, 0), "a settle's re-pose");
    h.stand(60, 0);
    expect(h.chip.textContent).toBe(
      "No station here - what you place next starts a new one.",
    );
    h.stand(100, 0);
    expect(h.chip.textContent).toBe(
      "In Station 2 - what you place here joins it.",
    );
  });

  // Why (M5c review #3): a pin lands at the reticle, not at the phone. A
  // creator standing inside a station's radius and aiming 10 m past its
  // edge was told "joins it" and got a new station.
  it("judges the open station where the reticle points while it is visible, else where the creator stands", () => {
    const h = harness();
    h.aim([30, 0]);
    h.stand(20, 0);
    expect(h.chip.textContent).toBe(
      "No station here - what you place next starts a new one.",
    );
    h.tour.place(pin("aimed", 30, 0), {}, "a pin");
    expect(h.stations.placedIn("aimed")).toBe("it starts Station 2");
    // The reticle hidden: the creator's own spot decides.
    h.aim(null);
    h.stand(5, 0);
    expect(h.chip.textContent).toBe(
      "In Station 1 - what you place here joins it.",
    );
  });

  // Why (PR #642 review): the reticle decides the WORDS (where the next pin
  // lands), but the ring is the boundary the creator walks along. Judged at
  // the reticle too, it vanished exactly when the creator aimed past the
  // edge to probe it - the moment it is needed most.
  it("rings the station the creator stands in while the reticle aims past its edge", () => {
    const h = harness();
    h.aim([27, 0]);
    h.stand(22, 0);
    expect(h.chip.textContent).toBe(
      "No station here - what you place next starts a new one.",
    );
    const ring = h.ring();
    expect(ring).toBeDefined();
    expect(ring!.position.x).toBeCloseTo(0, 6);
    expect(ring!.position.z).toBeCloseTo(0, 6);
    h.tour.place(pin("probe", 27, 0), {}, "a pin");
    expect(h.stations.placedIn("probe")).toBe("it starts Station 2");
    // The reticle back inside: the words follow it, the ring stays.
    h.tour.remove("probe", "the probe");
    h.aim([10, 0]);
    h.stand(22, 0);
    expect(h.chip.textContent).toBe(
      "In Station 1 - what you place here joins it.",
    );
    expect(h.ring()).toBeDefined();
    // The creator outside every radius, the reticle inside one: the words
    // name it, and no ring is drawn for a station the creator is not in.
    h.aim([20, 0]);
    h.stand(40, 0);
    expect(h.chip.textContent).toBe(
      "In Station 1 - what you place here joins it.",
    );
    expect(h.ring()).toBeUndefined();
  });

  it("keeps the line's promise wherever the pin lands, the reticle up to 10 m ahead or hidden (property)", () => {
    // D21 through the composed HUD: the line read just before a placement
    // names the station the placement joins, or says none is open and the
    // placement starts one. The hosted station's radius swept 15-40 m (the
    // stations a placement starts take the automatic 25 m).
    const joins = /^In (.+) - what you place here joins it.$/;
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            // Near the hosted station, so the reticle often crosses an edge.
            north: fc.integer({ min: -50, max: 50 }),
            east: fc.integer({ min: -50, max: 50 }),
            ahead: fc.option(
              fc.record({
                metres: fc.double({ min: 0, max: 10, noNaN: true }),
                bearing: fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
              }),
              { nil: null },
            ),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        fc.integer({ min: 15, max: 40 }),
        (walk, radiusM) => {
          const h = harness({ radiusM });
          for (const [i, step] of walk.entries()) {
            const lands: [number, number] =
              step.ahead === null
                ? [step.north, step.east]
                : [
                    step.north +
                      step.ahead.metres * Math.cos(step.ahead.bearing),
                    step.east +
                      step.ahead.metres * Math.sin(step.ahead.bearing),
                  ];
            h.aim(step.ahead === null ? null : lands);
            h.stand(step.north, step.east);
            const said = joins.exec(h.chip.textContent)?.[1] ?? null;
            const id = "p" + String(i);
            h.tour.place(pin(id, lands[0], lands[1]), {}, "a pin");
            const where = h.stations.placedIn(id);
            const got =
              where?.startsWith("it starts ") === true ? "starts" : where;
            expect(got).toBe(said === null ? "starts" : "in " + said);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  // Why this test matters: the walk's photos once went into stations at
  // the first Finish, so the HUD could not see them and hedged every name
  // ("may change at Finish"). They are baked into stations when the
  // recording opens now: the HUD names the walk's own stations from the
  // start, and a pin placed in one is told the station it will be written
  // in, with no hedge.
  it("names a station the walk's photos started, from the open on, without a hedge", () => {
    const photoAt = pin("photo", 100, 0).geo;
    const h = harness({
      opened: withWalkPhotos(tourOf([pin("gate", 0, 0)]), {
        fixes: 9,
        gpsAccuracyMedianM: 4,
        captures: [
          {
            image: "images/frame-1.jpg",
            geo: { ...photoAt, rotation: [0, 0, 0, 1] },
          },
        ],
      }),
    });
    h.stand(100, 0);
    expect(h.chip.textContent).toBe(
      "In Station 2 - what you place here joins it.",
    );
    h.tour.place(pin("near", 101, 0), {}, "a pin");
    expect(h.stations.placedIn("near")).toBe("in Station 2");
    expect(h.stations.nameOf("near")).toBe("Station 2");
  });

  // Why (M5c review #4): the HUD once read stations a Finish would start
  // under order-numbered ids that shifted when an earlier one was deleted,
  // and forgot the station the creator left ("No station here" instead of
  // "You left ..."). A station now keeps its id from its first placement.
  it("still names the station the creator left after an earlier unwritten station is deleted", () => {
    const h = harness();
    h.tour.place(pin("a", 60, 0), {}, "a pin");
    h.tour.place(pin("b", 200, 0), {}, "a pin");
    h.stand(200, 0);
    expect(h.chip.textContent).toBe(
      "In Station 3 - what you place here joins it.",
    );
    h.tour.remove("a", "a pin");
    h.stand(300, 0);
    expect(h.chip.textContent).toBe(
      "You left Station 2 - what you place next starts a new station.",
    );
  });

  it("still names the station the creator left after a Finish wrote it", () => {
    const h = harness();
    h.tour.place(pin("far", 60, 0), {}, "a pin");
    h.stand(60, 0);
    expect(h.chip.textContent).toBe(
      "In Station 2 - what you place here joins it.",
    );
    // The Finish writes the station under the id the document gave it,
    // and the working copy starts again from the written tour.
    const generation = h.tour.saveStarted();
    h.tour.saved({
      generation,
      written: manifestToWrite(h.tour.state())!,
      appliedDeletions: [],
      stationsAtStart: h.tour.state().stations,
    });
    h.tour.saveEnded(generation);
    h.stand(120, 0);
    expect(h.chip.textContent).toBe(
      "You left Station 2 - what you place next starts a new station.",
    );
  });

  it("a creator who never stood in a station is told none is here", () => {
    const h = harness();
    h.stand(80, 0);
    expect(h.chip.textContent).toBe(
      "No station here - what you place next starts a new one.",
    );
  });
});
