import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type {
  TourManifest,
  TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { calcGpsCoords } from "gps-plus-slam-app-framework/core";
import { Group, Mesh, type RingGeometry } from "three";

import { tourOf } from "./test-support/v3-tour.js";
import {
  openStationAt,
  placedInText,
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
 * the Finish writes, a pin the HUD said "joins Station 2" would land in a
 * new station - silently, discovered only by a visitor. So the stations
 * are read through the Finish's own writer, and the HUD's promise is a
 * property: a pin placed where the creator stands lands in the station the
 * HUD called open, or starts a new one when it called none.
 */

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

describe("stationsAsFinished", () => {
  it("is the Finish's assignment: a pin within R joins the station, one beyond starts a new one, named by its place", () => {
    const manifest = tourOf([pin("gate", 0, 0)]);
    const stations = stationsAsFinished({
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
    const stations = stationsAsFinished({
      manifest,
      placed: [pin("near", 5, 0)],
      deleted: ["gate"],
    });
    expect(stations.map((s) => s.name)).toEqual(["The gate"]);
    expect(stations[0]!.itemIds).toEqual(["near"]);
    expect(
      stationsAsFinished({ manifest: null, placed: [], deleted: [] }),
    ).toEqual([]);
  });

  it("never names an unwritten station like a hosted one", () => {
    // A hosted station could carry any id; the HUD's own ids for the
    // stations the Finish would start must never collide with one.
    const hosted = tourOf([pin("gate", 0, 0)]);
    const manifest: TourManifest = {
      ...hosted,
      stations: hosted.stations.map((s) => ({ ...s, id: "unwritten-1" })),
    };
    const stations = stationsAsFinished({
      manifest,
      placed: [pin("far", 60, 0)],
      deleted: [],
    });
    expect(stations.map((s) => s.started)).toEqual([false, true]);
    expect(new Set(stations.map((s) => s.id)).size).toBe(2);
  });
});

describe("openStationAt", () => {
  it("is the nearest station within R, R itself inside, none beyond", () => {
    const stations = stationsAsFinished({
      manifest: tourOf([pin("a", 0, 0), pin("b", 40, 0)]),
      placed: [],
      deleted: [],
    });
    expect(openStationAt(stations, at(24, 0))?.id).toBe("st-b");
    expect(openStationAt(stations, at(10, 0))?.id).toBe("st-a");
    expect(openStationAt(stations, at(0, 25))?.id).toBe("st-a");
    expect(openStationAt(stations, at(0, 26))).toBeNull();
    expect(openStationAt(stations, at(0, 30), 35)?.id).toBe("st-a");
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
            const before = stationsAsFinished({
              manifest,
              placed,
              deleted: [],
              radiusM,
            });
            const open = openStationAt(before, at(north, east), radiusM);
            const id = `p${String(i)}`;
            placed.push(pin(id, north, east));
            const after = stationsAsFinished({
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

  it("says a placement started a station only for its first element", () => {
    const stations = [station("Station 3", true), station("Station 1")];
    expect(placedInText(stations, "first")).toBe("it starts Station 3");
    expect(placedInText(stations, "second")).toBe("in Station 3");
    expect(placedInText([station("Station 1")], "first")).toBe("in Station 1");
    expect(placedInText(stations, "nowhere")).toBeNull();
  });
});

describe("wireCreatorStations", () => {
  function harness() {
    const scene = new Group();
    const ctx: {
      tourManifest: TourManifest | null;
      placedObjects: { object: TourObject }[];
      deletedObjectIds: string[];
    } = {
      tourManifest: tourOf([pin("gate", 0, 0)]),
      placedObjects: [],
      deletedObjectIds: [],
    };
    const chip = { textContent: "", hidden: true };
    let creator: [number, number, number] | null = [5, 401.5, 0];
    let sceneNow: Group | null = scene;
    const stations = wireCreatorStations({
      ctx,
      dom: { chip },
      creatorNue: () => creator,
      zero: () => zero,
      scene: () => sceneNow,
    });
    const ring = () =>
      scene.children.find((c) => c.name === STATION_RING_NAME) as
        Mesh | undefined;
    return {
      ctx,
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
    h.ctx.placedObjects.push({ object: pin("far", 60, 0) });
    expect(h.stations.placedIn("far")).toBe("it starts Station 2");
    h.stand(60, 0);
    expect(h.chip.textContent).toBe(
      "In Station 2 - what you place here joins it.",
    );
    h.ctx.placedObjects.push({ object: pin("next", 62, 0) });
    expect(h.stations.placedIn("next")).toBe("in Station 2");
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
    h.ctx.tourManifest = null;
    h.stand(5, 0);
    expect(h.chip.hidden).toBe(true);
    const g = harness();
    g.noScene();
    g.stand(5, 0);
    expect(g.chip.hidden).toBe(true);
  });

  it("a creator who never stood in a station is told none is here", () => {
    const h = harness();
    h.stand(80, 0);
    expect(h.chip.textContent).toBe(
      "No station here - what you place next starts a new one.",
    );
  });
});
